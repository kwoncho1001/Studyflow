/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, Component, ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 bg-red-600/10 rounded-3xl flex items-center justify-center mb-6 border border-red-500/20">
            <X className="text-red-500" size={40} />
          </div>
          <h1 className="text-3xl font-black text-white mb-4 tracking-tighter">애플리케이션 오류</h1>
          <p className="text-zinc-500 max-w-md mb-8">죄송합니다. 처리 중 예기치 않은 오류가 발생했습니다. 아래 버튼을 눌러 새로고침 하거나 나중에 다시 시도해 주세요.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-2xl transition-all"
          >
            화면 새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
import { Home, BookOpen, PenTool, Layout, ChevronLeft, Sparkles, Loader2, X } from 'lucide-react';
import { dbService } from './lib/db';
import { Subject, SubjectFile } from './types';
import { generateId } from './lib/utils';
import HomeView from './components/HomeView';
import StudyRoom from './components/StudyRoom';
import LearningView from './components/LearningView';
import ExamView from './components/ExamView';
import CurriculumView from './components/CurriculumView';
import CurriculumDesigner from './components/CurriculumDesigner';
import MaterialUploader from './components/MaterialUploader';
import { motion, AnimatePresence } from 'motion/react';

type ViewState = 
  | { type: 'home' }
  | { type: 'study-room'; subjectId: string }
  | { type: 'roadmap'; subjectId: string }
  | { type: 'learning'; subjectId: string; postId: string }
  | { type: 'exam'; subjectId: string; fileId?: string };

export default function App() {
  const [view, setView] = useState<ViewState>({ type: 'home' });
  const [currentSubject, setCurrentSubject] = useState<Subject | null>(null);
  
  // Curriculum Designer State - Always start as false on page load/refresh
  const [isDesigning, setIsDesigning] = useState(false);
  
  const [designStatus, setDesignStatus] = useState('');
  const [designProgress, setDesignProgress] = useState(0);
  const [curriculumSubjectId, setCurriculumSubjectId] = useState<string | null>(null);
  const [curriculumFiles, setCurriculumFiles] = useState<SubjectFile[]>([]);
  
  // Persist designer state to sessionStorage
  useEffect(() => {
    try {
      // Only persist if currently designing
      if (isDesigning) {
        sessionStorage.setItem('isDesigning', 'true');
        sessionStorage.setItem('designStatus', designStatus);
        sessionStorage.setItem('designProgress', String(designProgress));
        if (curriculumSubjectId) {
            sessionStorage.setItem('curriculumSubjectId', curriculumSubjectId);
        }
        sessionStorage.setItem('curriculumFiles', JSON.stringify(curriculumFiles));
      } else {
        // Clear on completion or cancellation
        sessionStorage.removeItem('isDesigning');
        sessionStorage.removeItem('designStatus');
        sessionStorage.removeItem('designProgress');
        sessionStorage.removeItem('curriculumSubjectId');
        sessionStorage.removeItem('curriculumFiles');
      }
    } catch (e) {
      console.warn("Session storage persistence failed", e);
    }
  }, [isDesigning, designStatus, designProgress, curriculumSubjectId, curriculumFiles]);

  // Monitor isDesigning
  useEffect(() => {
    console.log('isDesigning changed to:', isDesigning);
  }, [isDesigning]);

  const [designTrigger, setDesignTrigger] = useState(0);
  const [curriculumRefreshCounter, setCurriculumRefreshCounter] = useState(0);
  const [materialRefreshCounter, setMaterialRefreshCounter] = useState(0);

  // Global Uploads State
  const [activeUploads, setActiveUploads] = useState<Array<{
    id: string, 
    subjectId: string, 
    files: File[], 
    type: 'lecture' | 'recording' | 'exam'
  }>>([]);

  const handleStartUpload = (subjectId: string, files: File[], type: 'lecture' | 'recording' | 'exam') => {
    const newUpload = {
      id: generateId(),
      subjectId,
      files,
      type
    };
    setActiveUploads(prev => [...prev, newUpload]);
  };

  useEffect(() => {
    if ((view.type === 'study-room' || view.type === 'learning' || view.type === 'exam') && view.subjectId) {
      dbService.getSubjects().then(subjects => {
        const sub = subjects.find(s => s.id === view.subjectId);
        if (sub) setCurrentSubject(sub);
      });
    } else {
      setCurrentSubject(null);
    }
  }, [view]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-black text-white">
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-zinc-800 px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {view.type !== 'home' && (
            <button 
              onClick={() => {
                if (view.type === 'learning' || view.type === 'exam') {
                  setView({ type: 'roadmap', subjectId: view.subjectId });
                } else if (view.type === 'roadmap') {
                  setView({ type: 'study-room', subjectId: view.subjectId });
                } else {
                  setView({ type: 'home' });
                }
              }}
              className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-white">
            <div className="w-8 h-8 bg-blue-600 flex items-center justify-center rounded-lg shadow-lg shadow-blue-500/20">
              <BookOpen size={18} className="text-white" />
            </div>
            <span>Study Hub</span>
          </div>
          {currentSubject && (
            <div className="ml-4 pl-4 border-l border-zinc-800 flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-500 font-bold">과목</span>
              <span className="text-sm font-medium text-white">{currentSubject.name}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
           <button 
             onClick={() => setView({ type: 'home' })}
             className="p-2 text-zinc-400 hover:text-white transition-colors"
           >
              <Home size={20} />
           </button>
           <div className="w-px h-4 bg-zinc-800 mx-1" />
           <button 
             onClick={() => {
               if (currentSubject) {
                 setView({ type: 'roadmap', subjectId: currentSubject.id });
               }
             }}
             disabled={!currentSubject}
             className="p-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
           >
              <Layout size={20} />
           </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 w-full flex flex-col">
        {view.type === 'home' && (
          <HomeView 
            onEnterSubject={(id) => setView({ type: 'study-room', subjectId: id })} 
            onEnterRoadmap={(id) => setView({ type: 'roadmap', subjectId: id })}
          />
        )}
        {view.type === 'study-room' && (
          <StudyRoom 
            subjectId={view.subjectId} 
            refreshCounter={materialRefreshCounter}
            isDesigning={isDesigning}
            onEnterRoadmap={() => setView({ type: 'roadmap', subjectId: view.subjectId })}
            onStartDesign={(subjectId, files) => {
              setCurriculumSubjectId(subjectId);
              setCurriculumFiles(files);
              setDesignTrigger(prev => prev + 1);
            }}
            onStartUpload={handleStartUpload}
          />
        )}
        {view.type === 'roadmap' && (
          <CurriculumView 
            subjectId={view.subjectId}
            onEnterPost={(postId) => setView({ type: 'learning', subjectId: view.subjectId, postId })}
            onEnterExam={(fileId) => setView({ type: 'exam', subjectId: view.subjectId, fileId })}
            onBackToMaterials={() => setView({ type: 'study-room', subjectId: view.subjectId })}
            onRegenerate={() => {
              setCurriculumSubjectId(view.subjectId);
              // We need to fetch files for regeneration
              dbService.getFiles(view.subjectId).then(files => {
                setCurriculumFiles(files);
                setDesignTrigger(prev => prev + 1);
              });
            }}
            isDesigning={isDesigning}
            refreshCounter={curriculumRefreshCounter}
          />
        )}
        {view.type === 'learning' && (
          <LearningView 
            subjectId={view.subjectId} 
            postId={view.postId} 
            onBack={() => setView({ type: 'roadmap', subjectId: view.subjectId })}
            onNavigate={(postId) => setView({ ...view, postId })}
          />
        )}
        {view.type === 'exam' && (
          <ExamView 
            subjectId={view.subjectId} 
            fileId={view.fileId}
            onBack={() => setView({ type: 'roadmap', subjectId: view.subjectId })}
          />
        )}
      </main>

      {/* Background Subtle elements */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10 bg-black">
        <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-blue-600/5 rounded-full blur-[120px]" />
      </div>

      {/* AI Curriculum Designer Global Status (Top Right Notification) */}
      <AnimatePresence>
        {isDesigning && (
          <motion.div 
            key="designer-popup"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            className="fixed top-24 right-8 z-[210] w-[340px] bg-blue-600 border border-blue-400/30 rounded-2xl p-4 shadow-2xl flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
               <Loader2 size={18} className="animate-spin text-white" />
            </div>
            <div className="flex-1 min-w-0 pr-2">
               <div className="flex items-center justify-between gap-2">
                 <h3 className="text-sm font-bold text-white tracking-tight">AI 커리큘럼 설계 중...</h3>
                 <button 
                   onClick={() => {
                     const controller = (window as any).curriculumAbortController;
                     if (controller) controller.abort();
                   }}
                   className="text-[10px] font-black text-white/70 hover:text-white uppercase tracking-widest"
                 >
                   취소
                 </button>
               </div>
               <p className="text-[11px] text-white/70 font-medium mt-1 truncate">
                 {designStatus}
               </p>
               <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
                 <motion.div 
                   className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" 
                   animate={{ width: `${designProgress}%` }} 
                   transition={{ duration: 0.8, ease: "easeOut" }}
                 />
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Curriculum Designer (Logic only) */}
      {curriculumSubjectId && (
        <CurriculumDesigner 
          key={designTrigger} // Restart when trigger changes
          subjectId={curriculumSubjectId} 
          files={curriculumFiles} 
          onRefresh={() => {
            setCurriculumRefreshCounter(prev => prev + 1);
          }}
          onDesigningChange={(d) => {
            if (d) {
              (window as any).curriculumAbortController = new AbortController();
            } else {
              delete (window as any).curriculumAbortController;
            }
            setIsDesigning(d);
          }}
          abortSignal={(window as any).curriculumAbortController?.signal}
          onStatusChange={setDesignStatus}
          onProgressChange={setDesignProgress}
          autoStart={designTrigger > 0}
        />
      )}

      {/* Global Material Uploaders */}
      <div className="fixed top-24 right-8 z-[200] flex flex-col gap-4">
        <AnimatePresence>
          {activeUploads.map((upload) => (
            <motion.div 
              key={upload.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-[340px]"
            >
               <MaterialUploader 
                  subjectId={upload.subjectId} 
                  uploadId={upload.id}
                  files={upload.files}
                  type={upload.type}
                  onUploadComplete={(id) => {
                    setActiveUploads(prev => prev.filter(u => u.id !== id));
                    setMaterialRefreshCounter(prev => prev + 1);
                  }}
                  onCancel={(id) => {
                    setActiveUploads(prev => prev.filter(u => u.id !== id));
                  }}
               />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  </ErrorBoundary>
);
}

