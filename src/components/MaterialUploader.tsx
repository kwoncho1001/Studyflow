import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Mic, ClipboardList, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { generateId, cn } from '../lib/utils';
import { dbService } from '../lib/db';
import { aiService } from '../lib/ai';
import { SubjectFile, Unit } from '../types';
import { motion } from 'motion/react';
import * as pdfjs from 'pdfjs-dist';

// pdfjs worker setup
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface MaterialUploaderProps {
  subjectId: string;
  onUploadComplete: (uploadId: string) => void;
  onCancel?: (uploadId: string) => void;
  uploadId: string;
  files: File[];
  type: 'lecture' | 'recording' | 'exam';
}

const startedUploads = new Set<string>();

// Simple concurrency control utilities
class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private capacity: number) {}

  async acquire() {
    if (this.capacity > 0) {
      this.capacity--;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.capacity++;
    }
  }
}

// Global file processing lock (limit 2 concurrent files across all instances)
const fileLock = new Semaphore(2);

// Task-level concurrency limit (limit 5 concurrent AI calls per file)
async function pLimit<T>(items: any[], mapper: (item: any, index: number) => Promise<T>, limit: number): Promise<T[]> {
  const results: T[] = [];
  const semaphore = new Semaphore(limit);
  
  await Promise.all(
    items.map(async (item, idx) => {
      await semaphore.acquire();
      try {
        results[idx] = await mapper(item, idx);
      } finally {
        semaphore.release();
      }
    })
  );
  
  return results;
}

export default function MaterialUploader({ subjectId, onUploadComplete, onCancel, uploadId, files, type }: MaterialUploaderProps) {
  const [processing, setProcessing] = useState(true);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(files.length);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // Start processing on mount
  useEffect(() => {
    mountedRef.current = true;
    if (startedUploads.has(uploadId)) return;
    startedUploads.add(uploadId);
    
    processQueue(files, type);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetStatus = (s: string) => mountedRef.current && setStatus(s);
  const safeSetProgress = (p: number) => mountedRef.current && setProgress(p);
  const safeSetError = (e: string) => mountedRef.current && setError(e);
  const safeSetCurrentFileIndex = (i: number) => mountedRef.current && setCurrentFileIndex(i);

  const processQueue = async (files: File[], type: 'lecture' | 'recording' | 'exam') => {
    setProcessing(true);
    safeSetError('');
    setTotalFiles(files.length);
    
    try {
      for (let i = 0; i < files.length; i++) {
        // Acquire file lock before processing each file
        safeSetStatus(`큐 대기 중... (${i+1}/${files.length})`);
        await fileLock.acquire();
        
        try {
          safeSetCurrentFileIndex(i);
          safeSetProgress(0);
          safeSetStatus(`[${i+1}/${files.length}] ${files[i].name} 분석 준비...`);
          
          if (type.toString() === 'recording') {
            await processRecording(files[i]);
          } else {
            await processPdf(files[i], type as 'lecture' | 'exam');
          }
        } finally {
          fileLock.release();
        }
      }
      onUploadComplete(uploadId);
    } catch (err) {
      console.error(err);
      safeSetError('신경망 처리에 실패했습니다. 서버 혼잡도에 따라 다시 시도해 주십시오.');
    } finally {
      console.log('MaterialUploader processing finished for:', uploadId);
      if (mountedRef.current) setProcessing(false);
    }
  };

  const processRecording = async (file: File) => {
    const rawText = await file.text();
    safeSetStatus('언어 토큰 전처리 중...');
    safeSetProgress(5);
    
    // Heuristic Pre-processing
    const cleanedText = rawText
      .replace(/\s+/g, ' ')
      .trim();

    safeSetStatus('AI 정제 및 단락 구분 중...');
    
    // Sliding window for recordings: chunk size 10000, overlap 1000
    const chunkSize = 10000;
    const overlap = 1000;
    const chunks: string[] = [];
    
    if (cleanedText.length <= chunkSize) {
      chunks.push(cleanedText);
    } else {
      let start = 0;
      while (start < cleanedText.length) {
        const end = Math.min(start + chunkSize, cleanedText.length);
        chunks.push(cleanedText.slice(start, end));
        if (end === cleanedText.length) break;
        start += (chunkSize - overlap);
      }
    }
    
    // Concurrency Limited Segmentation (Limit 3 per file)
    const segmentationResults = await pLimit(
      chunks,
      async (chunk) => aiService.segmentRecording(chunk),
      3
    );
    
    const finalSegments = segmentationResults.flat();
    safeSetProgress(40);
    safeSetStatus(`AI 단락 구분 완료. 데이터 벡터화 중...`);
    
    const fileId = generateId();
    
    // Concurrency Limited Vectorization (Limit 5 per file)
    const units: Unit[] = await pLimit(
      finalSegments,
      async (segment, i) => {
        const embedding = await aiService.getEmbedding(segment);
        return {
          id: generateId(),
          fileId,
          subjectId,
          index: i,
          content: segment,
          embedding,
          type: 'recording'
        };
      },
      5
    );

    safeSetProgress(100);
    const subjectFile: SubjectFile = {
      id: fileId,
      subjectId,
      name: file.name,
      type: 'recording',
      mode: 'core',
      createdAt: Date.now(),
      totalUnits: finalSegments.length
    };

    await dbService.addFile(subjectFile);
    await dbService.addUnits(units);
  };

  const processPdf = async (file: File, type: 'lecture' | 'exam') => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const fileId = generateId();

    setStatus(`전체 ${numPages}페이지 분석 준비...`);
    setProgress(0);

    const pool: Array<{ pageNumber: number; text: string }> = [];

    // --- STEP 1 & 2: Parallel Transcription & Image Conversion ---
    const pageIndices = Array.from({ length: numPages }, (_, i) => i + 1);
    let completedPages = 0;

    const transcripts = await pLimit(
      pageIndices,
      async (pageNum) => {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await (page.render({ canvasContext: context, viewport: viewport } as any)).promise;
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
        const buffer = await blob.arrayBuffer();

        const rawTranscription = await aiService.transcribePage(buffer, type);
        
        completedPages++;
        safeSetStatus(`[Step 1/2] ${completedPages}/${numPages} 페이지 분석 완료...`);
        safeSetProgress(Math.round((completedPages / numPages) * 50));
        
        return { pageNumber: pageNum, text: rawTranscription };
      },
      3
    );

    pool.push(...transcripts);
    pool.sort((a, b) => a.pageNumber - b.pageNumber);
    
    // Save raw transcripts immediately
    await dbService.addRawTranscripts(fileId, pool);

    if (type === 'lecture') {
      // Lecture logic: Sliding Window Chunking (v2.1)
      safeSetStatus('[Step 2/2] 지식 구조화 및 청킹 중...');
      
      const fullText = pool.map(p => p.text).join('\n\n');
      
      // Sliding window: chunk size 10000, overlap 1000
      const chunkSize = 10000;
      const overlap = 1000;
      const chunks: string[] = [];
      
      if (fullText.length <= chunkSize) {
        chunks.push(fullText);
      } else {
        let start = 0;
        while (start < fullText.length) {
          const end = Math.min(start + chunkSize, fullText.length);
          chunks.push(fullText.slice(start, end));
          if (end === fullText.length) break;
          start += (chunkSize - overlap);
        }
      }

      // Concurrency Limited Chunk Processing (Limit 3)
      const segmentationResults = await pLimit(
        chunks,
        async (chunk, i) => {
          safeSetStatus(`[Step 2/2] 청크 ${i + 1}/${chunks.length} 분석 중...`);
          
          let segments: string[] = [];
          try {
            segments = await aiService.segmentLectureChunk(chunk);
          } catch (err) {
            console.warn(`Chunk ${i + 1} failed, retrying with Strong Summary`);
            try {
              segments = await aiService.segmentLectureChunkStrongSummary(chunk);
            } catch (err2) {
              segments = [chunk];
            }
          }
          return segments;
        },
        3
      );

      const allSegments = segmentationResults.flat();
      safeSetStatus(`[Step 2/2] 데이터 벡터화 중... (${allSegments.length}개 유닛)`);

      const finalUnits: Unit[] = await pLimit(
        allSegments,
        async (segment, i) => {
          const embedding = await aiService.getEmbedding(segment);
          return {
            id: generateId(),
            fileId,
            subjectId,
            index: i,
            content: segment,
            embedding,
            type: 'lecture'
          };
        },
        5
      );

      await dbService.addFile({ 
        id: fileId, 
        subjectId, 
        name: file.name, 
        type: 'lecture', 
        mode: 'core', 
        createdAt: Date.now(), 
        totalUnits: finalUnits.length,
        rawTranscripts: pool
      });
      await dbService.addUnits(finalUnits);
      setProgress(100);
      return;
    }

    // --- Exam Flow ---
    // STEP 3: Anchor: Global Metadata (1 call)
    safeSetStatus('[Step 2/3] 시험 전체 정보 확정 중...');
    const globalMetadata = await aiService.determineGlobalMetadata(pool[0].text, file.name);
    safeSetProgress(60);

    // STEP 4: Merge & Sliding Window for Exams
    safeSetStatus('[Step 3/3] 문항 추출 및 정제 중...');
    const fullText = pool.map(p => p.text).join('\n\n---\n\n');
    
    // Updated as per Step 4: Chunk-10000, Overlap-1000
    const chunkSize = 10000;
    const overlap = 1000;
    const chunks: string[] = [];
    
    if (fullText.length <= chunkSize) {
      chunks.push(fullText);
    } else {
      let start = 0;
      while (start < fullText.length) {
        const end = Math.min(start + chunkSize, fullText.length);
        chunks.push(fullText.slice(start, end));
        if (end === fullText.length) break;
        start += (chunkSize - overlap);
      }
    }

    const allParsedQuestions: Array<{ 
      id: string; 
      questionText: string; 
      pageIndex: number; 
      embedding?: number[];
      metadata: any; 
    }> = [];
    const seenQuestionIds = new Set<string>();
    
    const chunkResults = await pLimit(
      chunks,
      async (chunk, i) => {
        safeSetStatus(`[Step 3/3] 청크 ${i+1}/${chunks.length} 문항 합성 중...`);
        return await aiService.synthesizeExamQuestions(chunk, globalMetadata);
      },
      3
    );

    for (let i = 0; i < chunkResults.length; i++) {
      const synthesisResults = chunkResults[i];
      for (const q of synthesisResults) {
        const qId = q.id;
        if (seenQuestionIds.has(qId)) continue;
        seenQuestionIds.add(qId);

        const embedding = await aiService.getEmbedding(q.text);
        allParsedQuestions.push({
          id: qId,
          questionText: q.text,
          pageIndex: Math.floor(i * (chunkSize - overlap) / (fullText.length / numPages)) + 1,
          embedding,
          metadata: globalMetadata
        });
      }
    }

    const finalUnits: Unit[] = allParsedQuestions.map((q, idx) => ({
      id: generateId(),
      fileId,
      subjectId,
      index: idx + 1,
      content: q.questionText,
      embedding: q.embedding || [],
      type: 'exam',
      questionIds: [q.id]
    }));

    // STEP 6: Save
    await dbService.addFile({
      id: fileId,
      subjectId,
      name: file.name,
      type: 'exam',
      mode: 'core',
      createdAt: Date.now(),
      totalUnits: allParsedQuestions.length,
      examYear: globalMetadata.year,
      examTerm: globalMetadata.term,
      examType: globalMetadata.type,
      grade: globalMetadata.grade,
      parsedQuestions: allParsedQuestions,
      rawTranscripts: pool
    });
    await dbService.addUnits(finalUnits);
    setProgress(100);
  };

  return (
    <div className="bg-[#1a1b1e]/90 backdrop-blur-xl border border-zinc-800 rounded-2xl p-4 shadow-2xl flex items-start gap-4 animate-in slide-in-from-right-4 duration-500">
      <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
        {processing ? <Loader2 size={18} className="animate-spin text-blue-500" /> : error ? <AlertCircle size={18} className="text-red-500" /> : <CheckCircle2 size={18} className="text-emerald-500" />}
      </div>
      
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white truncate pr-2">
            {totalFiles > 1 ? `[${currentFileIndex + 1}/${totalFiles}] ` : ''}
            {files[currentFileIndex]?.name || '분석 중...'}
          </h3>
          <span className="text-[10px] font-black text-blue-500 shrink-0">{progress}%</span>
        </div>
        <p className="text-[11px] text-zinc-500 font-medium mt-1 truncate">
          {error || status}
        </p>
        {!error && (
          <div className="mt-3 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]" 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }} 
              transition={{ duration: 0.3 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
