import { useState, useEffect, useRef } from 'react';
import { 
  FileText, Mic, ClipboardList, Settings, Sparkles, 
  ChevronRight, Play, AlertCircle, Loader2, CheckCircle2,
  Trash2, Layers, Plus, Download, BookOpen, X, Edit2, Save, Check, RefreshCw
} from 'lucide-react';
import { dbService } from '../lib/db';
import { aiService } from '../lib/ai';
import { SubjectFile, Gallery, ConceptPost, Subject, Unit, InterpretationMode, CategoryMode, MaterialType, PersonaType, DesignSettings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { generateId, cn } from '../lib/utils';

interface StudyRoomProps {
  subjectId: string;
  refreshCounter: number;
  isDesigning: boolean;
  onEnterRoadmap: () => void;
  onStartDesign: (subjectId: string, files: SubjectFile[]) => void;
  onStartUpload: (subjectId: string, files: File[], type: 'lecture' | 'recording' | 'exam') => void;
}

export default function StudyRoom({ subjectId, refreshCounter, isDesigning, onEnterRoadmap, onStartDesign, onStartUpload }: StudyRoomProps) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [files, setFiles] = useState<SubjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCurriculum, setHasCurriculum] = useState(false); // 가공된 커리큘럼(갤러리) 존재 여부
  const [hasExamsOnly, setHasExamsOnly] = useState(false); // 기출문제만 있고 강의자료는 없는 경우
  const [activeOverlay, setActiveOverlay] = useState<'viewContent' | 'reviewExam' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [sortOrder, setSortOrder] = useState<Record<MaterialType, { key: 'name' | 'createdAt', dir: 'asc' | 'desc' }>>({
    lecture: { key: 'createdAt', dir: 'desc' },
    recording: { key: 'createdAt', dir: 'desc' },
    exam: { key: 'createdAt', dir: 'desc' }
  });
  const [uploadType, setUploadType] = useState<MaterialType | null>(null);

  // Exam Review State
  const [reviewMetadata, setReviewMetadata] = useState({ year: '', term: '', type: '', grade: '' });
  const [reviewQuestions, setReviewQuestions] = useState<Array<{ id: string, questionText: string, pageIndex: number }>>([]);
  const [reanalyzing, setReanalyzing] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && uploadType) {
      onStartUpload(subjectId, Array.from(files), uploadType);
      setUploadType(null);
    }
    e.target.value = '';
  };
  const [localCustomPersona, setLocalCustomPersona] = useState("");
  const [selectedFileForView, setSelectedFileForView] = useState<SubjectFile | null>(null);
  const [viewingUnits, setViewingUnits] = useState<Unit[]>([]);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const txtInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();

    // 1분마다 자동 새로고침 (60000ms)
    const interval = setInterval(() => {
      loadData(true); // silent refresh
    }, 60000);

    return () => clearInterval(interval);
  }, [subjectId, refreshCounter]);

  const handleAddClick = (type: MaterialType) => {
    setUploadType(type);
    if (type === 'recording') {
      txtInputRef.current?.click();
    } else {
      pdfInputRef.current?.click();
    }
  };

  const updateCategoryMode = async (type: MaterialType, mode: CategoryMode) => {
    if (!subject) return;
    const newCategoryModes = { ...(subject.categoryModes || {}), [type]: mode };
    const updatedSubject = { ...subject, categoryModes: newCategoryModes };
    await dbService.saveSubject(updatedSubject);
    setSubject(updatedSubject);

    // If not custom, update all files in this category
    if (mode !== 'custom') {
      const filesToUpdate = files.filter(f => f.type === type);
      for (const file of filesToUpdate) {
        const updatedFile = { ...file, mode };
        await dbService.updateFile(updatedFile);
      }
      setFiles(prev => prev.map(f => (f.type === type ? { ...f, mode: mode } : f)));
    }
  };

  const updateFileMode = async (fileId: string, mode: InterpretationMode) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    const updatedFile = { ...file, mode };
    await dbService.updateFile(updatedFile);
    setFiles(prev => prev.map(f => (f.id === fileId ? updatedFile : f)));
  };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [s, f, g] = await Promise.all([
        dbService.getSubjects().then(subs => subs.find(sub => sub.id === subjectId) || null),
        dbService.getFiles(subjectId),
        dbService.getGalleries(subjectId)
      ]);
      setSubject(s);
      if (s) setLocalCustomPersona(s.customPersona || "");
      setFiles(f);
      const hasG = g.length > 0;
      const hasL = f.some(x => x.type === 'lecture' || x.type === 'recording');
      const hasE = f.some(x => x.type === 'exam');
      
      setHasCurriculum(hasG);
      setHasExamsOnly(!hasG && hasE && !hasL);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleViewContent = async (file: SubjectFile) => {
    setSelectedFileForView(file);
    setViewingUnits([]);
    setEditingQuestionIndex(null);
    
    if (file.type === 'exam') {
      setReviewMetadata({
        year: file.examYear || '',
        term: file.examTerm || '',
        type: file.examType || '',
        grade: file.grade || ''
      });
      setReviewQuestions(file.parsedQuestions || []);
      setActiveOverlay('reviewExam');
    } else {
      setActiveOverlay('viewContent');
    }
    
    const db = await dbService.getDB();
    const units = await db.getAllFromIndex('units', 'fileId', file.id);
    setViewingUnits(units.sort((a, b) => a.index - b.index));
  };

  const handleStartEdit = (idx: number, text: string) => {
    setEditingQuestionIndex(idx);
    setEditingText(text);
  };

  const handleSaveExamReview = async () => {
    if (!selectedFileForView) return;
    
    // Synchronize current edits to reviewQuestions
    const updatedFile: SubjectFile = {
      ...selectedFileForView,
      examYear: reviewMetadata.year,
      examTerm: reviewMetadata.term,
      examType: reviewMetadata.type,
      grade: reviewMetadata.grade,
      parsedQuestions: reviewQuestions,
      totalUnits: reviewQuestions.length
    };
    
    // Sync with Units table: Every question is now a unit
    setReanalyzing(true); // show loader during vectorization
    try {
      const syncingUnits: Unit[] = [];
      for (let i = 0; i < reviewQuestions.length; i++) {
        const q = reviewQuestions[i];
        const embedding = await aiService.getEmbedding(q.questionText);
        syncingUnits.push({
          id: generateId(),
          fileId: selectedFileForView.id,
          subjectId,
          index: i + 1,
          content: q.questionText,
          embedding,
          type: 'exam',
          questionIds: [q.id]
        });
      }

      await dbService.updateFile(updatedFile);
      await dbService.deleteUnitsByFile(selectedFileForView.id);
      await dbService.addUnits(syncingUnits);
      
      setFiles(prev => prev.map(f => f.id === updatedFile.id ? updatedFile : f));
      setViewingUnits(syncingUnits);
      setActiveOverlay(null);
    } catch (err) {
      console.error(err);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleReanalyzeQuestions = async () => {
    if (!selectedFileForView) return;
    setReanalyzing(true);
    
    try {
      // Use original raw transcript if possible to get pure context
      const rawTranscripts = await dbService.getRawTranscripts(selectedFileForView.id);
      const sourceData = rawTranscripts.length > 0 
        ? rawTranscripts.map(r => ({ content: r.text, index: r.pageNumber }))
        : viewingUnits; // fallback to current units (which might be the questions already)

      if (sourceData.length === 0) return;

      // Step 2: Determine Global Context first
      const firstSource = sourceData.find(s => s.index === 1) || sourceData[0];
      const globalMetadata = await aiService.determineGlobalMetadata(
        firstSource.content,
        selectedFileForView.name
      );
      
      // Update UI metadata state
      setReviewMetadata(globalMetadata);

      const allNewQuestions: any[] = [];
      let questionCounter = 1;

      // Step 3: Synthesis for each page/unit
      for (const source of sourceData) {
        const questions = await aiService.synthesizeExamQuestions(
          source.content,
          globalMetadata
        );
        
        for (const qObj of questions) {
          const qId = `[${globalMetadata.year}-${globalMetadata.term}-${globalMetadata.type}-Q${String(questionCounter).padStart(2, '0')}]`;
          allNewQuestions.push({
            id: qId,
            questionText: qObj.text,
            pageIndex: source.index
          });
          questionCounter++;
        }
      }
      setReviewQuestions(allNewQuestions);
    } catch (err) {
      console.error(err);
    } finally {
      setReanalyzing(false);
    }
  };

  const updateSubjectSetting = async (updates: Partial<Subject>) => {
    if (!subject) return;
    const updated = { ...subject, ...updates };
    await dbService.saveSubject(updated);
    setSubject(updated);
  };

  const updateDesignSettings = async (updates: Partial<DesignSettings>) => {
    if (!subject) return;
    const currentSettings = subject.designSettings || {
      galleryCohesion: 0.7,
      minGalleryVolume: 3,
      postGranularity: 0.8,
      minPostScale: 2,
      bindingThreshold: 0.75
    };
    const updatedSettings = { ...currentSettings, ...updates };
    await updateSubjectSetting({ designSettings: updatedSettings });
  };

  const handleDeleteFile = async (id: string) => {
    setFileToDelete(id);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;
    await dbService.deleteFile(fileToDelete);
    setFiles(files.filter(f => f.id !== fileToDelete));
    setFileToDelete(null);
  };

  if (loading) {
     return (
       <div className="flex flex-col items-center justify-center py-48 animate-pulse space-y-6">
         <div className="w-20 h-20 rounded-full border border-zinc-800 flex items-center justify-center relative">
           <div className="absolute inset-0 bg-blue-500/5 rounded-full blur-xl" />
           <Loader2 size={32} className="animate-spin text-blue-500" />
         </div>
         <p className="text-zinc-500 font-medium text-lg tracking-tight text-center italic">시맨틱 저장소 로드 중...</p>
       </div>
     );
  }

  return (
    <div className="w-full px-6 md:px-20 py-12">
      <div className="space-y-12 animate-in fade-in duration-700 max-w-7xl mx-auto">
      {/* Subject Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 px-2">
        <div className="space-y-2">
          <h1 className="text-4xl font-black text-white tracking-tighter">{subject?.name || '과목 미정'}</h1>
          <p className="text-zinc-500 font-medium text-sm">학습 자료를 업로드하고 갤러리(대주제) 커리큘럼을 생성하세요.</p>
        </div>
        <button className="flex items-center gap-2 bg-[#1a1b1e] border border-zinc-800 text-zinc-300 px-6 py-3 rounded-xl font-bold text-sm hover:bg-zinc-800 hover:text-white transition-all shadow-2xl">
          <Download size={16} />
          과목 내보내기
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 items-start">
        {/* Left Column: Material Management */}
        <div className="space-y-8">
          <section className="bg-[#0c0c0e] border border-zinc-800/60 rounded-[2.5rem] overflow-hidden shadow-2xl">
            <div className="p-8 border-b border-zinc-900 flex items-center justify-between gap-4">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner">
                   <Layers size={20} className="text-zinc-400" />
                 </div>
                 <h2 className="text-xl font-bold text-white tracking-tight">학습 자료 관리</h2>
               </div>
               
               <button 
                 onClick={() => loadData(false)}
                 className={cn(
                   "group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-all active:scale-95",
                   loading && "opacity-50 cursor-not-allowed"
                 )}
                 title="새로고침"
               >
                 <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">Refresh</span>
                 <RefreshCw size={16} className={cn(loading && "animate-spin")} />
               </button>
            </div>
            
            <div className="p-6 space-y-4">
              <MaterialGroup 
                title="강의자료" 
                desc="교재, PPT 등 뼈대가 되는 자료" 
                icon={<FileText size={20} />} 
                type="lecture"
                files={files.filter(f => f.type === 'lecture')}
                onAdd={() => handleAddClick('lecture')}
                onDelete={handleDeleteFile}
                onViewContent={handleViewContent}
                sortOrder={sortOrder.lecture}
                onSortChange={(key) => setSortOrder(prev => ({ ...prev, lecture: { key, dir: prev.lecture.key === key ? (prev.lecture.dir === 'asc' ? 'desc' : 'asc') : 'asc' } }))}
                categoryMode={subject?.categoryModes?.lecture || 'core'}
                onCategoryModeChange={(mode) => updateCategoryMode('lecture', mode)}
                onFileModeChange={updateFileMode}
              />
              <MaterialGroup 
                title="녹음본" 
                desc="실제 수업 스크립트, 강조 포인트" 
                icon={<Mic size={20} />} 
                type="recording"
                files={files.filter(f => f.type === 'recording')}
                onAdd={() => handleAddClick('recording')}
                onDelete={handleDeleteFile}
                onViewContent={handleViewContent}
                sortOrder={sortOrder.recording}
                onSortChange={(key) => setSortOrder(prev => ({ ...prev, recording: { key, dir: prev.recording.key === key ? (prev.lecture.dir === 'asc' ? 'desc' : 'asc') : 'asc' } }))}
                categoryMode={subject?.categoryModes?.recording || 'core'}
                onCategoryModeChange={(mode) => updateCategoryMode('recording', mode)}
                onFileModeChange={updateFileMode}
              />
              <MaterialGroup 
                title="기출문제" 
                desc="실전 감각 및 출제 포인트" 
                icon={<ClipboardList size={20} />} 
                type="exam"
                files={files.filter(f => f.type === 'exam')}
                onAdd={() => handleAddClick('exam')}
                onDelete={handleDeleteFile}
                onViewContent={handleViewContent}
                sortOrder={sortOrder.exam}
                onSortChange={(key) => setSortOrder(prev => ({ ...prev, exam: { key, dir: prev.exam.key === key ? (prev.exam.dir === 'asc' ? 'desc' : 'asc') : 'asc' } }))}
                categoryMode={subject?.categoryModes?.exam || 'core'}
                onCategoryModeChange={(mode) => updateCategoryMode('exam', mode)}
                onFileModeChange={updateFileMode}
              />
            </div>
          </section>

          <input 
            type="file" 
            ref={pdfInputRef} 
            multiple
            onChange={handleFileChange}
            className="hidden" 
            accept=".pdf" 
          />
          <input 
            type="file" 
            ref={txtInputRef} 
            multiple
            onChange={handleFileChange}
            className="hidden" 
            accept=".txt" 
          />

          {/* Curriculum Transition Banner */}
          <div className="pt-16 mt-16 border-t border-zinc-900">
            {hasCurriculum || hasExamsOnly ? (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-blue-600/10 to-[#0c0c0e] border border-blue-500/20 p-12 rounded-[3.5rem] flex flex-col md:flex-row items-center justify-between gap-10 shadow-2xl relative overflow-hidden group hover:border-blue-500/40 transition-all duration-700"
              >
                 <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[120px] group-hover:bg-blue-600/20 transition-all duration-700" />
                 <div className="flex items-center gap-10 relative z-10">
                   <div className="w-24 h-24 bg-blue-600/10 rounded-[2.5rem] border border-blue-500/20 flex items-center justify-center shadow-2xl group-hover:scale-110 group-hover:rotate-12 transition-all duration-500">
                     <Sparkles size={48} className="text-blue-500" />
                   </div>
                   <div className="space-y-3">
                     <div className="flex items-center gap-3">
                       <span className="px-3 py-1 bg-blue-600 text-[10px] font-black text-white rounded-full uppercase tracking-widest shadow-lg shadow-blue-600/20">Active Blueprint</span>
                     </div>
                     <h3 className="text-4xl font-black text-white tracking-tighter">AI 커리큘럼 학습장 진입</h3>
                     <p className="text-zinc-500 text-sm max-w-md font-medium leading-relaxed">설계된 지식 맵을 바탕으로 몰입도 높은 학습을 시작하세요.</p>
                   </div>
                 </div>
                 <div className="flex flex-col gap-4 relative z-10 w-full md:w-auto">
                    <button 
                      onClick={onEnterRoadmap}
                      className="flex items-center justify-center gap-4 bg-blue-600 text-white px-12 py-6 rounded-[2rem] font-black hover:bg-blue-500 hover:shadow-[0_0_50px_rgba(37,99,235,0.4)] active:scale-95 transition-all shadow-2xl"
                    >
                      <span className="text-xl font-black">학습 시작하기</span>
                      <ChevronRight size={24} className="group-hover:translate-x-2 transition-transform" />
                    </button>
                    <button 
                      onClick={() => onStartDesign(subjectId, files)}
                      className="text-xs font-bold text-zinc-600 hover:text-blue-500 transition-colors py-2"
                    >
                      커리큘럼 다시 설계하기
                    </button>
                 </div>
              </motion.div>
            ) : (
              files.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-br from-[#121316] to-[#0a0a0b] border border-blue-500/10 p-12 rounded-[3rem] flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl relative overflow-hidden group"
                >
                   <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/5 rounded-full blur-[120px] group-hover:bg-blue-500/10 transition-all duration-700" />
                   <div className="flex items-center gap-10 relative z-10">
                     <div className="w-20 h-20 bg-blue-600/10 rounded-3xl border border-blue-500/20 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                       <Sparkles size={40} className="text-blue-500" />
                     </div>
                     <div className="space-y-2">
                       <h3 className="text-3xl font-bold text-white tracking-tighter">AI 커리큘럼 설계 준비</h3>
                       <p className="text-zinc-500 text-sm max-w-md font-medium leading-relaxed">업로드된 자료를 분석하여 최적의 학습 경로를 생성합니다.</p>
                     </div>
                   </div>
                   <button 
                     onClick={() => onStartDesign(subjectId, files)}
                     className="w-full md:w-auto flex items-center justify-center gap-4 bg-blue-600 text-white px-10 py-5 rounded-2xl font-bold hover:bg-blue-500 hover:shadow-[0_0_40px_rgba(37,99,235,0.4)] active:scale-95 transition-all shadow-2xl group relative z-10"
                   >
                     <span className="text-lg font-bold">커리큘럼 생성하기</span>
                     <ChevronRight size={22} className="group-hover:translate-x-1 transition-transform" />
                   </button>
                </motion.div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Settings Sidebar */}
        <div className="space-y-8">
          <SidebarSection title="AI 페르소나 설정">
            <div className="grid grid-cols-1 gap-4">
              <PersonaCard 
                active={subject?.persona === 'standard' || !subject?.persona} 
                onClick={() => updateSubjectSetting({ persona: 'standard' })}
                title="정석형 (Standard)" 
                desc="교과서적 정의와 논리적 전개 집중 (비유 농도: Low)" 
              />
              <PersonaCard 
                active={subject?.persona === 'easy'} 
                onClick={() => updateSubjectSetting({ persona: 'easy' })}
                title="친절형 (Easy)" 
                desc="보편적인 비유를 섞어 진입 장벽을 낮춤 (비유 농도: Medium)" 
                isHighlighted
              />
              <PersonaCard 
                active={subject?.persona === 'meme'} 
                onClick={() => updateSubjectSetting({ persona: 'meme' })}
                title="유머형 (Meme)" 
                desc="재미있는 상황극과 드립으로 지루함 제거 (비유 농도: High)" 
              />
              <PersonaCard 
                active={subject?.persona === 'custom'} 
                onClick={() => updateSubjectSetting({ persona: 'custom' })}
                title="사용자 설정 (Custom)" 
                desc="원하는 페르소나를 직접 텍스트로 입력" 
              />
              {subject?.persona === 'custom' && (
                <textarea
                  value={localCustomPersona}
                  onChange={(e) => setLocalCustomPersona(e.target.value)}
                  onBlur={() => updateSubjectSetting({ customPersona: localCustomPersona })}
                  placeholder="예: 아주 엄격하고 질문이 많은 교수님처럼 말해줘."
                  className="w-full bg-[#111215] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none transition-all mt-2"
                  rows={3}
                />
              )}
            </div>
          </SidebarSection>

          <SidebarSection title="AI 설계 아키텍처">
            <div className="space-y-10">
              <div className="space-y-6">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">주제(Gallery) 그룹화</span>
                </div>
                <TunerSlider 
                  label="그룹화 민감도" 
                  desc="자료 간 유사성을 얼마나 엄격하게 따져서 그룹화할지 설정합니다." 
                  value={subject?.designSettings?.galleryCohesion ?? 0.7} 
                  min={0.5} max={0.9} step={0.05}
                  onChange={(v) => updateDesignSettings({ galleryCohesion: v })}
                />
                <TunerSlider 
                  label="최소 주제 규모" 
                  desc="하나의 대주제(갤러리)로 인정받기 위한 최소 자료 개수입니다." 
                  value={subject?.designSettings?.minGalleryVolume ?? 3} 
                  min={1} max={15} step={1}
                  onChange={(v) => updateDesignSettings({ minGalleryVolume: v })}
                  unit="개"
                />
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">개념(Post) 분리</span>
                </div>
                <TunerSlider 
                  label="개념 정밀도" 
                  desc="전체 학습 내용을 얼마나 더 세부적인 포스트 단위로 나눌지 설정합니다." 
                  value={subject?.designSettings?.postGranularity ?? 0.8} 
                  min={0.6} max={0.95} step={0.05}
                  onChange={(v) => updateDesignSettings({ postGranularity: v })}
                />
                <TunerSlider 
                  label="최소 개념 규모" 
                  desc="하나의 포스트로 독립되기 위해 필요한 최소 자료 개수입니다." 
                  value={subject?.designSettings?.minPostScale ?? 2} 
                  min={1} max={10} step={1}
                  onChange={(v) => updateDesignSettings({ minPostScale: v })}
                  unit="개"
                />
              </div>

              <div className="pt-6 border-t border-zinc-900">
                <TunerSlider 
                  label="외부 자료 결합 강도" 
                  desc="본문 흐름과 연관성이 높은 보조 자료만 엄격하게 선별해 포함합니다." 
                  value={subject?.designSettings?.bindingThreshold ?? 0.75} 
                  min={0.5} max={0.9} step={0.05}
                  onChange={(v) => updateDesignSettings({ bindingThreshold: v })}
                />
              </div>
            </div>
          </SidebarSection>
        </div>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {activeOverlay === 'reviewExam' && selectedFileForView && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/90 backdrop-blur-md"
               onClick={() => setActiveOverlay(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="w-full max-w-3xl max-h-[90vh] bg-[#0c0c0e] border border-zinc-800 rounded-[2.5rem] overflow-hidden shadow-2xl relative z-10 flex flex-col"
            >
              <div className="p-8 border-b border-zinc-900 bg-zinc-900/10 flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-white tracking-tight">기출문제 검토 및 수정</h2>
                  <p className="text-xs text-zinc-500 font-medium">AI가 자동으로 추출한 메타데이터와 문항입니다. 잘못된 부분이 있다면 수정 후 다시 분석하거나 저장할 수 있습니다.</p>
                </div>
                <button onClick={() => setActiveOverlay(null)} className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-zinc-800">
                <div className="grid grid-cols-2 gap-6 mb-10">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-1">연도 (필수)</label>
                    <input 
                      type="text" 
                      value={reviewMetadata.year}
                      onChange={(e) => setReviewMetadata(prev => ({ ...prev, year: e.target.value }))}
                      placeholder="2023"
                      className="w-full bg-[#111215] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-1">학기 (필수)</label>
                    <input 
                      type="text" 
                      value={reviewMetadata.term}
                      onChange={(e) => setReviewMetadata(prev => ({ ...prev, term: e.target.value }))}
                      placeholder="1학기"
                      className="w-full bg-[#111215] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-1">시험종류 (필수)</label>
                    <input 
                      type="text" 
                      value={reviewMetadata.type}
                      onChange={(e) => setReviewMetadata(prev => ({ ...prev, type: e.target.value }))}
                      placeholder="중간고사"
                      className="w-full bg-[#111215] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest pl-1">학년 (선택)</label>
                    <input 
                      type="text" 
                      value={reviewMetadata.grade}
                      onChange={(e) => setReviewMetadata(prev => ({ ...prev, grade: e.target.value }))}
                      placeholder="3학년"
                      className="w-full bg-[#111215] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="mb-10 text-center">
                  <button 
                    onClick={handleReanalyzeQuestions}
                    disabled={reanalyzing}
                    className="flex items-center gap-2 mx-auto bg-zinc-900 border border-zinc-800 text-zinc-400 px-6 py-3 rounded-full text-xs font-bold hover:bg-zinc-800 hover:text-white transition-all disabled:opacity-50"
                  >
                    {reanalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-blue-500" />}
                    입력한 정보로 문항 재분석하기
                  </button>
                </div>

                <div className="space-y-6">
                  <h3 className="text-sm font-bold text-zinc-400 pl-1">추출된 문항 ({reviewQuestions.length}개)</h3>
                  <div className="space-y-4">
                    {reviewQuestions.map((q, idx) => (
                      <div key={q.id || idx} className="bg-[#111215] border border-zinc-800 p-6 rounded-2xl space-y-3 group hover:border-zinc-700 transition-all">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-blue-500 tracking-wider">
                            {q.id}
                          </span>
                          <button 
                            onClick={() => handleStartEdit(idx, q.questionText)}
                            className="text-zinc-700 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                        
                        {editingQuestionIndex === idx ? (
                           <div className="space-y-3">
                              <textarea 
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full bg-black border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 min-h-[100px] outline-none"
                              />
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setEditingQuestionIndex(null)} className="text-[10px] font-bold text-zinc-600 px-2">취소</button>
                                <button 
                                  onClick={() => {
                                    const next = [...reviewQuestions];
                                    next[idx].questionText = editingText;
                                    setReviewQuestions(next);
                                    setEditingQuestionIndex(null);
                                  }}
                                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold"
                                >
                                  적용
                                </button>
                              </div>
                           </div>
                        ) : (
                          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{q.questionText}</p>
                        )}
                        
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-zinc-900 bg-zinc-900/30 flex justify-end gap-4">
                <button onClick={() => setActiveOverlay(null)} className="px-6 py-3 text-sm font-bold text-zinc-500 hover:text-white transition-colors">취소</button>
                <button 
                  onClick={handleSaveExamReview}
                  className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold text-sm hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all active:scale-95"
                >
                  저장 및 완료
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {activeOverlay === 'viewContent' && selectedFileForView && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/80 backdrop-blur-sm"
               onClick={() => setActiveOverlay(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-4xl max-h-[85vh] bg-[#0c0c0e] border border-zinc-800 rounded-[2.5rem] overflow-hidden shadow-2xl relative z-10 flex flex-col"
            >
              <div className="p-8 border-b border-zinc-900 flex items-center justify-between bg-zinc-900/30">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner">
                    <BookOpen size={20} className="text-blue-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">{selectedFileForView.name}</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
                      {viewingUnits.length > 0 ? `${viewingUnits.length}개 유닛 분석 완료` : '콘텐츠 로드 중...'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveOverlay(null)}
                  className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {viewingUnits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 animate-pulse text-zinc-600">
                    <Loader2 size={32} className="animate-spin mb-4" />
                    <p className="text-sm font-medium">콘텐츠를 불러오는 중입니다...</p>
                  </div>
                ) : (
                  selectedFileForView.type === 'exam' && selectedFileForView.parsedQuestions ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between mb-8 bg-black/40 p-6 rounded-2xl border border-zinc-800">
                         <div>
                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Exam Metadata</p>
                            <h3 className="text-lg font-bold text-white">{selectedFileForView.examYear} {selectedFileForView.examTerm} {selectedFileForView.examType}</h3>
                         </div>
                         <div className="text-right">
                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">Total Questions</p>
                            <p className="text-xl font-bold text-white">{selectedFileForView.parsedQuestions.length}</p>
                         </div>
                      </div>

                      {selectedFileForView.parsedQuestions.map((q, idx) => (
                        <div key={q.id || idx} className="group relative">
                          <div className="absolute -left-12 top-0 text-[10px] font-black text-zinc-800 group-hover:text-blue-900/40 transition-colors pt-4">
                            {q.id?.split('-').pop() || `Q${idx + 1}`}
                          </div>
                          <div className="bg-[#111215] border border-zinc-900 rounded-2xl p-8 hover:border-zinc-800 transition-all flex flex-col gap-4">
                            {editingQuestionIndex === idx ? (
                              <div className="space-y-4">
                                <textarea 
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  className="w-full bg-black border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 min-h-[150px] focus:border-blue-500 outline-none"
                                />
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setEditingQuestionIndex(null)} className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors">취소</button>
                                  <button 
                                    onClick={async () => {
                                      if (editingQuestionIndex === null || !selectedFileForView) return;
                                      const updatedQuestions = [...(selectedFileForView.parsedQuestions || [])];
                                      updatedQuestions[editingQuestionIndex] = { ...updatedQuestions[editingQuestionIndex], questionText: editingText };
                                      const updatedFile = { ...selectedFileForView, parsedQuestions: updatedQuestions };
                                      await dbService.updateFile(updatedFile);
                                      setFiles(prev => prev.map(f => f.id === updatedFile.id ? updatedFile : f));
                                      setSelectedFileForView(updatedFile);
                                      setEditingQuestionIndex(null);
                                    }}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-500 transition-all flex items-center gap-2"
                                  >
                                    <Check size={14} /> 저장
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex justify-between items-start gap-4">
                                  <div className="flex-1 prose prose-invert max-w-none prose-sm leading-relaxed text-zinc-300 italic whitespace-pre-wrap">
                                    {q.questionText}
                                  </div>
                                  <button 
                                    onClick={() => handleStartEdit(idx, q.questionText)}
                                    className="p-2 text-zinc-700 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all shrink-0"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    viewingUnits.map((unit, idx) => (
                      <div key={unit.id} className="group relative">
                        <div className="absolute -left-12 top-0 text-[10px] font-black text-zinc-800 group-hover:text-blue-900/40 transition-colors pt-1">
                          {unit.type === 'lecture' ? `PAGE ${String(unit.index).padStart(3, '0')}` : `데이터 #${String(idx + 1).padStart(3, '0')}`}
                        </div>
                        <div className="bg-[#111215] border border-zinc-900 rounded-2xl p-8 hover:border-zinc-800 transition-all">
                          <div className="prose prose-invert max-w-none">
                            <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap text-sm">
                              {unit.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}

        {fileToDelete && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/95 backdrop-blur-md"
              onClick={() => setFileToDelete(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-[#121316] border border-zinc-800 rounded-[2.5rem] p-10 max-w-md w-full relative z-10 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-red-500/10 rounded-3xl border border-red-500/20 flex items-center justify-center mx-auto mb-8">
                <Trash2 size={40} className="text-red-500" />
              </div>
              <h3 className="text-2xl font-bold text-white tracking-tight mb-3">자료 삭제 확인</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-10 font-medium">
                이 자료를 삭제하시겠습니까?<br/>
                연동된 모든 AI 분석 데이터가 즉시 파기됩니다.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setFileToDelete(null)}
                  className="flex-1 px-8 py-4 rounded-2xl bg-zinc-900 text-zinc-400 font-bold hover:bg-zinc-800 transition-all border border-zinc-800"
                >
                  취소
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 px-8 py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-500 hover:shadow-[0_0_30px_rgba(220,38,38,0.3)] transition-all"
                >
                  삭제하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

function MaterialGroup({ 
  title, desc, icon, type, files, onAdd, onDelete, onViewContent, sortOrder, onSortChange,
  categoryMode, onCategoryModeChange, onFileModeChange
}: { 
  title: string, desc: string, icon: any, type: MaterialType, files: SubjectFile[], onAdd: () => void, onDelete: (id: string) => void, onViewContent: (f: SubjectFile) => void,
  sortOrder: { key: 'name' | 'createdAt', dir: 'asc' | 'desc' },
  onSortChange: (key: 'name' | 'createdAt') => void,
  categoryMode: CategoryMode,
  onCategoryModeChange: (m: CategoryMode) => void,
  onFileModeChange: (id: string, m: InterpretationMode) => void
}) {
  const sortedFiles = [...files].sort((a, b) => {
    const modifier = sortOrder.dir === 'asc' ? 1 : -1;
    if (sortOrder.key === 'name') {
      return a.name.localeCompare(b.name) * modifier;
    }
    return (a.createdAt - b.createdAt) * modifier;
  });

  const modes: { id: CategoryMode; label: string; shortcut: string }[] = [
    { id: 'selective', label: '선별', shortcut: 'S' },
    { id: 'core', label: '기준', shortcut: 'C' },
    { id: 'supplement', label: '보조', shortcut: 'B' },
    { id: 'custom', label: '커스텀', shortcut: 'M' }
  ];

  return (
    <div className="group/section">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 px-4 py-3 bg-[#111215]/50 rounded-3xl border border-zinc-900 group-hover/section:border-zinc-800 transition-all">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-900/50 flex items-center justify-center text-zinc-500 shadow-inner">
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-base text-white tracking-tight">{title}</h3>
            <p className="text-[10px] text-zinc-600 font-medium">{desc}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 sm:mt-0">
          <div className="flex items-center bg-black/40 p-1 rounded-xl border border-zinc-900">
            {modes.map(m => (
              <button
                key={m.id}
                onClick={() => onCategoryModeChange(m.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center gap-1.5",
                  categoryMode === m.id 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                <span>{m.label}</span>
                {categoryMode === m.id && <span className="opacity-50 text-[8px] font-medium hidden lg:inline">{m.shortcut}</span>}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-zinc-800 hidden sm:block" />

          <div className="flex items-center gap-2">
            <button 
              onClick={() => onSortChange(sortOrder.key === 'name' && sortOrder.dir === 'asc' ? 'createdAt' : 'name')}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-zinc-500 hover:text-white transition-colors"
            >
              {sortOrder.key === 'name' ? '이름순' : '날짜순'}
            </button>
            <button 
              onClick={onAdd}
              className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 bg-[#1a1b1e] hover:bg-zinc-800 hover:text-white border border-zinc-800 px-4 py-2 rounded-xl transition-all shadow-xl active:scale-95"
            >
              <Plus size={12} />
              추가
            </button>
          </div>
        </div>
      </div>
      
      <div className="space-y-3 px-2">
        {sortedFiles.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-zinc-900 rounded-[2rem] mx-2 bg-zinc-900/10">
             <p className="text-[10px] font-black text-zinc-800 tracking-[3px] uppercase">NO DATA LOADED</p>
          </div>
        ) : (
          sortedFiles.map(file => (
            <div key={file.id} className="group/item relative bg-[#111215] border border-zinc-900/50 rounded-[2rem] p-5 flex flex-col gap-4 hover:border-zinc-800 hover:bg-[#141518] transition-all shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center transition-all",
                    file.mode === 'selective' ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                    file.mode === 'core' ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" :
                    "bg-zinc-500/10 text-zinc-500 border border-zinc-500/20"
                  )}>
                    <FileText size={18} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm font-bold text-zinc-300 block truncate max-w-[200px] sm:max-w-[400px]">{file.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">{new Date(file.createdAt).toLocaleDateString()}</span>
                      {categoryMode === 'custom' && (
                        <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-lg border border-zinc-900">
                          {['selective', 'core', 'supplement'].map((m) => (
                            <button
                              key={m}
                              onClick={() => onFileModeChange(file.id, m as InterpretationMode)}
                              className={cn(
                                "px-2 py-0.5 rounded text-[8px] font-black transition-all uppercase tracking-tighter",
                                file.mode === m 
                                  ? (m === 'selective' ? "bg-amber-500 text-white" : m === 'core' ? "bg-blue-600 text-white" : "bg-zinc-700 text-white")
                                  : "text-zinc-600 hover:text-zinc-400"
                              )}
                            >
                              {m.slice(0, 1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 opacity-0 group-hover/item:opacity-100 transition-opacity">
                  <button onClick={() => onViewContent(file)} className="p-3 text-zinc-600 hover:text-blue-500 hover:bg-blue-500/10 rounded-xl transition-all" title="내용 보기">
                    <BookOpen size={16} />
                  </button>
                  <button onClick={() => onDelete(file.id)} className="p-3 text-zinc-700 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="삭제">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="bg-[#0c0c0e] border border-zinc-800/60 rounded-[2.5rem] overflow-hidden shadow-2xl p-8 space-y-6">
      <h3 className="text-[11px] font-black text-zinc-600 uppercase tracking-[2px] border-b border-zinc-900 pb-4">{title}</h3>
      <div className="space-y-6">
        {children}
      </div>
    </div>
  );
}

function TunerSlider({ label, desc, value, min, max, step, onChange, unit = "" }: { label: string, desc: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit?: string }) {
  return (
    <div className="space-y-4 group">
      <div className="flex items-center justify-between gap-4">
        <label className="text-[11px] font-bold text-zinc-300 group-hover:text-blue-500 transition-colors">{label}</label>
        <div className="px-3 py-1 bg-zinc-900 rounded-lg border border-zinc-800 text-[10px] font-mono font-bold text-blue-500">
          {value.toFixed(step < 1 ? 2 : 0)}{unit}
        </div>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={value} 
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-zinc-900 rounded-full appearance-none outline-none cursor-pointer accent-blue-600 hover:accent-blue-500 transition-all"
      />
      <p className="text-[9px] text-zinc-500 font-medium leading-relaxed">{desc}</p>
    </div>
  );
}

function PersonaCard({ active, onClick, title, desc, isHighlighted }: { active: boolean, onClick: () => void, title: string, desc: string, isHighlighted?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full text-left p-5 rounded-2xl border transition-all relative overflow-hidden group shadow-sm",
        active 
          ? "bg-blue-600/5 border-blue-600/40 shadow-inner" 
          : "bg-[#111215] border-zinc-900/80 hover:border-zinc-800"
      )}
    >
      <h4 className={cn("text-xs font-bold mb-2 tracking-tight flex items-center gap-2", active ? "text-blue-500" : "text-zinc-200")}>
        {title}
        {active && isHighlighted && <CheckCircle2 size={12} className="text-blue-500" />}
      </h4>
      <p className="text-[10px] text-zinc-600 font-medium leading-relaxed">{desc}</p>
      
      {active && (
         <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/5 rounded-full blur-2xl" />
      )}
    </button>
  );
}


