import { useState, useEffect } from 'react';
import { Sparkles, Loader2, ArrowRight, CheckCircle2, RefreshCw, Layers, AlertCircle, ChevronRight, ClipboardList } from 'lucide-react';
import { dbService } from '../lib/db';
import { aiService } from '../lib/ai';
import { kMeans, averageVector, cosineSimilarity } from '../lib/math';
import { SubjectFile, Gallery, ConceptPost, Unit, Subject, DesignSettings } from '../types';
import { motion } from 'motion/react';
import { cn, generateId } from '../lib/utils';

interface CurriculumDesignerProps {
  subjectId: string;
  files: SubjectFile[];
  onRefresh: () => void;
  onDesigningChange?: (designing: boolean) => void;
  onStatusChange?: (status: string) => void;
  onProgressChange?: (progress: number) => void;
  autoStart?: boolean;
  abortSignal?: AbortSignal;
}

export default function CurriculumDesigner({ subjectId, files, onRefresh, onDesigningChange, onStatusChange, onProgressChange, autoStart, abortSignal }: CurriculumDesignerProps) {
  const [designing, setDesigning] = useState(false);
  const [phase, setPhase] = useState(0); // 0: Idle, 1: Gallery Design, 2: Concept Mapping
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (autoStart && !designing) {
      runArchitect();
    }
  }, [autoStart]);

  const checkAbort = () => {
    if (abortSignal?.aborted) {
      throw new Error('user_cancelled');
    }
  };

  const handleStatusUpdate = (s: string) => {
    checkAbort();
    setStatus(s);
    onStatusChange?.(s);
  };

  const handleProgressUpdate = (p: number) => {
    checkAbort();
    onProgressChange?.(p);
  };

  const handleDesigningUpdate = (d: boolean) => {
    setDesigning(d);
    onDesigningChange?.(d);
  };

  const runArchitect = async () => {
    handleDesigningUpdate(true);
    handleProgressUpdate(5);
    setError(null);
    try {
      // 0. Cleanup existing curriculum for this subject
      handleStatusUpdate('기존 커리큘럼을 정리하는 중...');
      await dbService.clearCurriculum(subjectId);
      
      // 1. Fetch Subject for settings
      const subject = await dbService.getSubject(subjectId);
      checkAbort();
      const settings = subject?.designSettings || {
        galleryCohesion: 0.6,
        minGalleryVolume: 1,
        postGranularity: 0.7,
        minPostScale: 1,
        bindingThreshold: 0.65
      };

      // 1. Fetch ALL units for the subject
      handleStatusUpdate('유닛 데이터를 수집하는 중...');
      const allUnits = await dbService.getUnits(subjectId);
      checkAbort();
      handleProgressUpdate(10);
      if (allUnits.length === 0) {
        throw new Error('분석할 자료 유닛이 없습니다.');
      }

      // ----------------------------------------------------------------------
      // PHASE 1: 갤러리 목차 확립 (과목 전체 수준)
      // ----------------------------------------------------------------------
      setPhase(1);
      handleStatusUpdate('의미 군집화 수행 중 (Phase 1)...');
      handleProgressUpdate(20);
      
      const coreUnits = allUnits.filter(u => {
        const file = files.find(f => f.id === u.fileId);
        return file?.mode === 'core';
      });

      if (coreUnits.length === 0) {
        throw new Error('Core(기준) 자료가 최소 한 개 이상 필요합니다.');
      }

      const vectors = coreUnits.map(u => u.embedding || []);
      // K-Means with settings-influenced K and filtering
      // Higher cohesion -> more clusters (finer split) or stricter merging?
      // User says: "높을수록 성격이 아주 명확한 주제만 살아남고, 낮을수록 다양한 맥락을 하나로 넓게 묶습니다."
      // So high cohesion = more clusters (smaller, more tight groups).
      const cohesionWeight = (settings.galleryCohesion - 0.5) * 10; // 0~4
      let k = Math.min(Math.max(3, Math.floor(coreUnits.length / (12 - cohesionWeight))), 15);
      let { clusters } = kMeans(vectors, k);
      
      // 군집 병합: 최소 볼륨(settings.minGalleryVolume) 미만은 제외 (Orphanage logic skipped per request)
      clusters = clusters.filter(indices => indices.length >= settings.minGalleryVolume || clusters.length <= 2); 

      handleStatusUpdate('AI가 대주제(갤러리)를 해석하는 중...');
      const clusterTexts = clusters.map(indices => 
        indices.map(idx => coreUnits[idx].content).join('\n').slice(0, 4000)
      );
      handleProgressUpdate(30);
      
      const galleryMeta = await aiService.generateGalleries(clusterTexts);
      checkAbort();
      handleProgressUpdate(40);
      
      const newGalleries: Gallery[] = [];
      for (let i = 0; i < galleryMeta.length; i++) {
        const meta = galleryMeta[i];
        handleStatusUpdate(`[갤러리] ${meta.name} 벡터화 중...`);
        
        // Gallery vectorization as requested via AI Metadata (Description + Keywords)
        const metaText = `${meta.name}: ${meta.description} ${meta.keywords.join(' ')}`;
        const metaVec = await aiService.getEmbedding(metaText);
        
        const gallery: Gallery = {
          id: generateId(),
          subjectId,
          name: meta.name,
          description: meta.description,
          keywords: meta.keywords,
          averageVector: metaVec, 
          order: i
        };
        newGalleries.push(gallery);
      }

      // Step 4: 전수 매핑 (Core 우선, 보조 매핑, Core 누락 체크)
      const galleryUnitMap: Record<string, string[]> = {};
      newGalleries.forEach(g => galleryUnitMap[g.id] = []);

      for (const unit of allUnits) {
        const file = files.find(f => f.id === unit.fileId);
        const isCore = file?.mode === 'core';
        const isSelective = file?.mode === 'selective';
        
        const similarities = newGalleries.map(g => ({
          galleryId: g.id,
          sim: cosineSimilarity(unit.embedding || [], g.averageVector)
        }));
        
        similarities.sort((a, b) => b.sim - a.sim);
        const best = similarities[0];
        if (!best) continue;

        // Mapping thresholds using settings.bindingThreshold
        // Core now needs to meet the Minimum Gallery Cohesion to be included
        const threshold = isSelective 
          ? Math.min(settings.bindingThreshold + 0.05, 0.95) 
          : (isCore ? (settings.galleryCohesion * 0.8) : settings.bindingThreshold);
        
        // Core content is always assigned to the best matching gallery regardless of threshold
        // to prevent data loss in curriculum. Selective/Supplement still follow threshold.
        const isActuallyAssigned = isCore || (best.sim >= threshold);
        
        if (isActuallyAssigned) {
          galleryUnitMap[best.galleryId].push(unit.id);
        }
      }

      // Natural Selection: Filter out galleries that have no core units or are too small
      // If we have few units, we keep all galleries that AI generated to avoid empty curriculum
      const activeGalleries = newGalleries.filter(g => {
        const units = galleryUnitMap[g.id] || [];
        const coreCount = allUnits.filter(u => units.includes(u.id) && files.find(f => f.id === u.fileId)?.mode === 'core').length;
        return coreCount >= Math.min(settings.minGalleryVolume, 1);
      });

      if (activeGalleries.length === 0 && newGalleries.length > 0) {
        // Fallback: Just take the first few galleries if filter was too strict
        activeGalleries.push(...newGalleries.slice(0, 3));
      }

      await dbService.saveGalleries(activeGalleries);
      handleProgressUpdate(50);

      // ----------------------------------------------------------------------
      // PHASE 2: 개념글 목차 확립 (갤러리별 세부 수준)
      // ----------------------------------------------------------------------
      setPhase(2);
      handleStatusUpdate('자료 매핑 및 개념글 설계 중 (Phase 2)...');
      
      for (let i = 0; i < activeGalleries.length; i++) {
        const gallery = activeGalleries[i];
        const progressStart = 50 + (i / newGalleries.length) * 45;
        handleProgressUpdate(progressStart);
        
        handleStatusUpdate(`[${gallery.name}] 개념글 설계 중...`);
        
        const galleryConceptUnits = allUnits.filter(u => {
          const file = files.find(f => f.id === u.fileId);
          return galleryUnitMap[gallery.id].includes(u.id) && file?.mode === 'core';
        });

        if (galleryConceptUnits.length === 0) continue;

        const subVectors = galleryConceptUnits.map(u => u.embedding || []);
        // Post Granularity influenced subK
        const granularityWeight = (settings.postGranularity - 0.6) * 10; // 0~3.5
        const subK = Math.min(Math.max(2, Math.floor(galleryConceptUnits.length / (8 - granularityWeight))), 8);
        let { clusters: subClusters } = kMeans(subVectors, subK);

        // Filter by minPostScale
        subClusters = subClusters.filter(indices => indices.length >= settings.minPostScale || subClusters.length <= 2);
        
        const subTexts = subClusters.map(indices => 
          indices.map(idx => galleryConceptUnits[idx].content).join('\n').slice(0, 3000)
        );

        const postMeta = await aiService.generateConceptPosts(gallery.name + ": " + gallery.description, subTexts);
        checkAbort();
        
        // Ensure we don't exceed AI output or cluster count
        const finalCount = Math.min(postMeta.length, subClusters.length);
        const newPosts: ConceptPost[] = [];
        const postVectors: number[][] = [];

        for (let j = 0; j < finalCount; j++) {
          const meta = postMeta[j];
          handleStatusUpdate(`[개념글] ${meta.title} 최적화 중...`);
          const postMetaText = `${meta.title}: ${meta.learningObjectives.join(' ')} ${meta.keywords.join(' ')}`;
          const postVec = await aiService.getEmbedding(postMetaText);
          postVectors.push(postVec);

          newPosts.push({
            id: generateId(),
            galleryId: gallery.id,
            subjectId,
            title: meta.title,
            content: '', 
            learningObjectives: meta.learningObjectives,
            keywords: meta.keywords,
            averageVector: postVec,
            order: j,
            mappedUnits: [] // Will fill in mapping step
          });
        }

        // Final Mapping for Post level
        const galleryAllUnits = allUnits.filter(u => galleryUnitMap[gallery.id].includes(u.id));
        for (const unit of galleryAllUnits) {
          const file = files.find(f => f.id === unit.fileId);
          const isCore = file?.mode === 'core';
          const isSelective = file?.mode === 'selective';

          const similarities = newPosts.map(p => ({
            postId: p.id,
            sim: cosineSimilarity(unit.embedding || [], p.averageVector)
          }));
          similarities.sort((a, b) => b.sim - a.sim);
          const best = similarities[0];
          if (!best) continue;

          const threshold = isSelective 
            ? Math.min(settings.bindingThreshold + 0.1, 0.98) // Posts are even stricter for Selective
            : (isCore ? (settings.postGranularity * 0.9) : settings.bindingThreshold + 0.05);

          const isActuallyAssigned = isCore || (best.sim >= threshold);

          if (isActuallyAssigned) {
            const p = newPosts.find(x => x.id === best.postId);
            if (p) p.mappedUnits.push(unit.id);
          }
        }

        // Natural Selection: Filter out posts that have no core units and are not quizzes
        const activePosts = newPosts.filter(p => {
          if (p.isQuizPost) return true;
          const coreCount = allUnits.filter(u => p.mappedUnits.includes(u.id) && files.find(f => f.id === u.fileId)?.mode === 'core').length;
          return coreCount >= settings.minPostScale;
        });
        
        activePosts.push({
          id: generateId(),
          galleryId: gallery.id,
          subjectId,
          title: "최종 시험",
          content: '',
          learningObjectives: ["Gallery-wide contextual mastery"],
          keywords: gallery.keywords,
          averageVector: gallery.averageVector,
          order: newPosts.length,
          isQuizPost: true,
          mappedUnits: galleryUnitMap[gallery.id] // Entire gallery data
        });

        await dbService.savePosts(activePosts);
      }

      handleStatusUpdate('완료!');
      handleProgressUpdate(100);
      onRefresh();
    } catch (err: any) {
      console.error(err);
      if (err.message === 'user_cancelled') {
        handleStatusUpdate('설계를 취소하고 데이터를 정리하는 중...');
        await dbService.clearCurriculum(subjectId);
        handleStatusUpdate('취소되었습니다.');
        setError('사용자에 의해 설계가 중단되었습니다.');
      } else {
        setError('설계 중 오류가 발생했습니다.');
      }
    } finally {
      handleDesigningUpdate(false);
      setPhase(0);
    }
  };

  return null; // Logic only component now
}
