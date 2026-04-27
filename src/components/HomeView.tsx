import { useState, useEffect } from 'react';
import { Plus, Trash2, Download, Upload, BookOpen, AlertCircle, Loader2, CheckCircle2, Settings, ChevronRight, Sparkles } from 'lucide-react';
import { dbService } from '../lib/db';
import { Subject } from '../types';
import { generateId, formatDate, cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import pako from 'pako';

interface HomeViewProps {
  onEnterSubject: (id: string) => void;
  onEnterRoadmap: (id: string) => void;
}

export default function HomeView({ onEnterSubject, onEnterRoadmap }: HomeViewProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectStats, setSubjectStats] = useState<Record<string, {
    totalUnits: number,    // Galleries
    learnedUnits: number,  // Learned Galleries
    totalPosts: number,
    learnedPosts: number,
    avgScore: number,
    lastStudied: number | null,
    intensity: number
  }>>({});
  const [newSubjectName, setNewSubjectName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [subjectToDelete, setSubjectToDelete] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSubjects();
  }, []);

  const loadSubjects = async () => {
    const list = await dbService.getSubjects();
    const sorted = list.sort((a, b) => (b.lastStudiedAt || 0) - (a.lastStudiedAt || 0));
    setSubjects(sorted);

    // Calculate stats for each subject
    const stats: Record<string, any> = {};
    for (const sub of sorted) {
      const [allGalleries, allPosts, examSessions] = await Promise.all([
        dbService.getGalleries(sub.id),
        dbService.getPosts(sub.id),
        dbService.getExamSessions(sub.id)
      ]);

      // Post progress
      const learnedPostsCount = allPosts.filter(p => p.isLearned).length;
      const totalPostsCount = allPosts.length;

      // Gallery (Unit) progress
      let learnedGalleriesCount = 0;
      allGalleries.forEach(g => {
        const galleryPosts = allPosts.filter(p => p.galleryId === g.id);
        if (galleryPosts.length > 0 && galleryPosts.every(p => p.isLearned)) {
          learnedGalleriesCount++;
        }
      });
      const totalGalleriesCount = allGalleries.length;
      
      let totalQuestions = 0;
      let correctAnswers = 0;
      examSessions.forEach(session => {
        const scores = Object.values(session.scores);
        totalQuestions += scores.length;
        correctAnswers += scores.filter(v => v).length;
      });
      const avgScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

      // Intensity based on total posts
      const intensity = totalPostsCount; 

      stats[sub.id] = {
        totalUnits: totalGalleriesCount,
        learnedUnits: learnedGalleriesCount,
        totalPosts: totalPostsCount,
        learnedPosts: learnedPostsCount,
        avgScore: avgScore,
        lastStudied: sub.lastStudiedAt || null,
        intensity: intensity
      };
    }
    setSubjectStats(stats);
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;

    const newSubject: Subject = {
      id: generateId(),
      name: newSubjectName.trim(),
      createdAt: Date.now(),
      designSettings: {
        galleryCohesion: 0.7,
        minGalleryVolume: 3,
        postGranularity: 0.8,
        minPostScale: 2,
        bindingThreshold: 0.75
      }
    };

    await dbService.addSubject(newSubject);
    setNewSubjectName('');
    setIsAdding(false);
    loadSubjects();
  };

  const handleDeleteSubject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSubjectToDelete(id);
  };

  const confirmDelete = async () => {
    if (!subjectToDelete) return;
    try {
      await dbService.deleteSubject(subjectToDelete);
      setSubjectToDelete(null);
      loadSubjects();
    } catch (err) {
      console.error(err);
      setError('과목 삭제 중 오류가 발생했습니다.');
    }
  };

  const handleExport = async () => {
    if (selectedExportIds.length === 0) return;
    
    try {
      const db = await dbService.getDB();

      for (const subId of selectedExportIds) {
        const subject = subjects.find(s => s.id === subId);
        if (!subject) continue;

        const exportData: any = {
          subjects: [subject],
          files: [],
          units: [],
          galleries: [],
          posts: [],
          chats: [],
          examSessions: [],
          version: '1.0',
          exportedAt: Date.now()
        };

        // Fetch all related data for this specific subject
        const [files, units, galleries, posts, examSessions] = await Promise.all([
          db.getAllFromIndex('files', 'subjectId', subId),
          db.getAllFromIndex('units', 'subjectId', subId),
          db.getAllFromIndex('galleries', 'subjectId', subId),
          db.getAllFromIndex('posts', 'subjectId', subId),
          db.getAllFromIndex('examSessions', 'subjectId', subId),
        ]);

        // Precision Reduction for embeddings
        const processedUnits = units.map((u: any) => ({
          ...u,
          embedding: u.embedding ? u.embedding.map((v: number) => parseFloat(v.toFixed(4))) : []
        }));

        exportData.files.push(...files);
        exportData.units.push(...processedUnits);
        exportData.galleries.push(...galleries);
        exportData.posts.push(...posts);
        exportData.examSessions.push(...examSessions);

        // Fetch chats for each post
        for (const post of posts) {
          const chats = await db.getAllFromIndex('chats', 'postId', post.id);
          exportData.chats.push(...chats);
        }

        const json = JSON.stringify(exportData, null, 2); // Standard formatted JSON as requested
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `studyflow-${subject.name}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        // Small delay between downloads to help browser handle multiple files
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      setIsSelectionMode(false);
      setSelectedExportIds([]);
    } catch (err) {
      console.error('Export error:', err);
      setError('내보내기 중 오류가 발생했습니다.');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    let successCount = 0;

    try {
      const db = await dbService.getDB();

      for (const file of Array.from(files)) {
        const content = await file.text();
        const data = JSON.parse(content);
        
        // Validation and Storage
        const tx = db.transaction(['subjects', 'files', 'units', 'galleries', 'posts', 'chats', 'examSessions'], 'readwrite');
        
        if (data.subjects) {
          for (const item of data.subjects) await tx.objectStore('subjects').put(item);
        }
        if (data.files) {
          for (const item of data.files) await tx.objectStore('files').put(item);
        }
        if (data.units) {
          for (const item of data.units) await tx.objectStore('units').put(item);
        }
        if (data.galleries) {
          for (const item of data.galleries) await tx.objectStore('galleries').put(item);
        }
        if (data.posts) {
          for (const item of data.posts) await tx.objectStore('posts').put(item);
        }
        if (data.chats) {
          for (const item of data.chats) await tx.objectStore('chats').put(item);
        }
        if (data.examSessions) {
          for (const item of data.examSessions) await tx.objectStore('examSessions').put(item);
        }

        await tx.done;
        successCount++;
      }
      
      loadSubjects();
      alert(`${successCount}개의 파일에서 데이터를 성공적으로 가져왔습니다.`);
    } catch (err) {
      console.error('Import error:', err);
      setError('데이터를 가져오는 중 오류가 발생했습니다. 파일 형식을 확인하세요.');
    } finally {
      setIsImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const toggleExportSelection = (id: string) => {
    setSelectedExportIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const totalProgress = subjects.length > 0
    ? Math.round(Object.values(subjectStats).reduce((acc, curr) => acc + (curr.totalUnits > 0 ? (curr.learnedUnits / curr.totalUnits) * 100 : 0), 0) / subjects.length)
    : 0;

  const timeAgo = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-12 py-10 w-full min-h-screen">
      <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      
      {/* Dashboard Header */}
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tight text-white flex items-center gap-3">
            Learning Command Center
          </h1>
          <p className="text-zinc-500 font-medium tracking-wide">Strategic overview of your knowledge assets</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl px-6 py-4 flex flex-col min-w-[140px] shadow-2xl">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Courses</span>
            <span className="text-3xl font-black text-blue-500">{subjects.length}</span>
          </div>
          <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl px-6 py-4 flex flex-col min-w-[140px] shadow-2xl">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Avg Progress</span>
            <span className="text-3xl font-black text-blue-500">{totalProgress}%</span>
          </div>
        </div>
      </header>

      {/* Action Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
        <div className="flex items-center gap-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {isSelectionMode ? (
            <div className="flex items-center gap-4">
              <button onClick={() => { setIsSelectionMode(false); setSelectedExportIds([]); }} className="text-xs font-black text-zinc-600 hover:text-white transition-all uppercase tracking-widest">Cancel</button>
              <button 
                onClick={handleExport}
                disabled={selectedExportIds.length === 0}
                className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 font-black text-xs shadow-xl shadow-emerald-600/20 disabled:opacity-30 transition-all uppercase tracking-widest"
              >
                Execute Export ({selectedExportIds.length})
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => setIsSelectionMode(true)} disabled={subjects.length === 0} className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-xl hover:text-white transition-all shadow-lg group">
                <Download size={20} />
              </button>
              <label className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-xl cursor-pointer hover:text-white transition-all shadow-lg group">
                {isImporting ? <Loader2 size={20} className="animate-spin text-blue-500" /> : <Upload size={20} />}
                <input type="file" multiple accept=".json" onChange={handleImport} className="hidden" />
              </label>
              <button onClick={() => setIsAdding(true)} className="flex items-center gap-3 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all font-black text-xs shadow-2xl shadow-blue-600/30 uppercase tracking-widest group">
                <Plus size={18} className="group-hover:rotate-90 transition-transform" />
                Deploy New Course
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <AnimatePresence>
          {isAdding && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -20 }}
              className="bg-[#0c0c0e] border border-zinc-800 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center gap-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                <BookOpen size={32} />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-xl font-bold text-white tracking-tight">과목 기지 구축</h3>
                <p className="text-sm text-zinc-500">학습 전략을 수립할 과목의 명칭을 입력하세요.</p>
              </div>
              <form onSubmit={handleCreateSubject} className="w-full max-w-md flex gap-2">
                <input 
                  autoFocus
                  type="text" 
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="과목명 (예: 일반화학 II)"
                  className="flex-1 px-6 py-4 bg-zinc-950 border border-zinc-800 rounded-2xl text-white focus:border-blue-500 outline-none transition-all placeholder:text-zinc-700 font-bold"
                />
                <button type="submit" className="bg-blue-600 text-white px-8 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all">Create</button>
              </form>
              <button onClick={() => setIsAdding(false)} className="text-xs font-bold text-zinc-600 hover:text-white transition-colors">취소</button>
            </motion.div>
          )}

          {subjectToDelete && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setSubjectToDelete(null)} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-[#0c0c0e] border border-zinc-800 rounded-[3rem] p-12 w-full max-w-md relative z-10 shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-8 border border-rose-500/20">
                  <AlertCircle size={32} />
                </div>
                <h3 className="text-3xl font-black text-white mb-4 tracking-tighter">Terminate Knowledge Asset?</h3>
                <p className="text-sm text-zinc-500 mb-10 leading-relaxed font-medium">
                  이 과목과 관련된 모든 시맨틱 자료, 커리큘럼, 학습 세션 데이터가 <span className="text-rose-400 font-black">영구 폐기</span>됩니다. 복구할 수 없습니다.
                </p>
                <div className="flex gap-4">
                  <button onClick={() => setSubjectToDelete(null)} className="flex-1 px-6 py-4 bg-zinc-900 text-zinc-500 rounded-2xl hover:text-white transition-all font-black text-xs uppercase tracking-widest">Abort</button>
                  <button onClick={confirmDelete} className="flex-1 bg-rose-600 text-white font-black py-4 rounded-2xl hover:bg-rose-500 transition-all text-xs shadow-2xl shadow-rose-600/40 uppercase tracking-widest">Delete Asset</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-6">
          {subjects.map((subject) => (
            <SubjectCommandCard 
              key={subject.id} 
              subject={subject} 
              stats={subjectStats[subject.id]}
              isSelected={selectedExportIds.includes(subject.id)}
              isSelectionMode={isSelectionMode}
              onEnter={() => {
                if (isSelectionMode) toggleExportSelection(subject.id);
                else onEnterSubject(subject.id);
              }}
              onEnterLearning={(id) => onEnterRoadmap(id)}
              onDelete={(id, e) => handleDeleteSubject(id, e)}
              timeAgoStr={timeAgo(subject.lastStudiedAt || null)}
            />
          ))}

          {subjects.length === 0 && !isAdding && (
            <div className="col-span-full border border-dashed border-zinc-800 rounded-[3rem] py-40 flex flex-col items-center justify-center text-zinc-700 space-y-4">
              <BookOpen size={64} className="opacity-10" />
              <p className="text-xl font-bold tracking-tight">No Strategic Assets Found</p>
              <p className="text-sm font-medium">새 과목을 추가하여 학습 사령부를 활성화하세요.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  </div>
  );
}

function SubjectCommandCard({ subject, stats, onEnter, onEnterLearning, onDelete, isSelected, isSelectionMode, timeAgoStr }: { 
  subject: Subject, 
  stats?: { 
    learnedUnits: number, 
    totalUnits: number, 
    learnedPosts: number,
    totalPosts: number,
    avgScore: number, 
    lastStudied: number | null, 
    intensity: number 
  },
  onEnter: () => void, 
  onEnterLearning: (id: string) => void,
  onDelete: (id: string, e: React.MouseEvent) => void,
  isSelected: boolean, 
  isSelectionMode: boolean,
  timeAgoStr: string
}) {
  const learnedU = stats?.learnedUnits || 0;
  const totalU = stats?.totalUnits || 0;
  const progressU = totalU > 0 ? Math.round((learnedU / totalU) * 100) : 0;

  const learnedP = stats?.learnedPosts || 0;
  const totalP = stats?.totalPosts || 0;
  const progressP = totalP > 0 ? Math.round((learnedP / totalP) * 100) : 0;

  const score = stats?.avgScore || 0;

  // Use Post progress for the main visualization
  const mainProgress = progressP;

  return (
    <motion.div 
      layout
      onClick={onEnter}
      className={cn(
        "group relative border rounded-[2rem] p-8 transition-all cursor-pointer flex items-center justify-between shadow-xl overflow-hidden",
        isSelectionMode && isSelected 
          ? "bg-blue-600/5 border-blue-500/50 shadow-[inset_0_0_20px_rgba(37,99,235,0.05)]" 
          : "bg-[#0c0c0e] border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/40"
      )}
    >
      <div className="flex-1 space-y-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl group-hover:scale-110 transition-transform">
            <BookOpen size={24} />
          </div>
          <h3 className="text-2xl font-black text-white tracking-tighter">{subject.name}</h3>
        </div>

        <div className="grid grid-cols-4 gap-8">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">Unit Progress</p>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-zinc-300">{learnedU}</span>
              <span className="text-xs font-bold text-zinc-600">/ {totalU} galleries</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">Avg Score</p>
            <p className="text-xl font-bold text-blue-400 leading-none">{score.toFixed(1)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">Post Progress</p>
            <div className="flex items-baseline gap-1">
              <Sparkles size={12} className="text-indigo-500 mb-0.5" />
              <span className="text-xl font-bold text-zinc-300">{learnedP}</span>
              <span className="text-xs font-bold text-zinc-600">/ {totalP} nodes</span>
            </div>
          </div>
          <div className="space-y-1 text-right">
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">Last Studied</p>
            <p className="text-xl font-bold text-zinc-400 leading-none">{timeAgoStr}</p>
          </div>
        </div>

        <div className="relative h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-900/50">
           <motion.div 
             initial={{ width: 0 }}
             animate={{ width: `${mainProgress}%` }}
             transition={{ duration: 1.5, ease: "easeOut" }}
             className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-400 shadow-[0_0_10px_rgba(37,99,235,0.3)]"
           />
        </div>
      </div>

      <div className="shrink-0 ml-12 flex items-center gap-10">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90">
            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-zinc-900" />
            <motion.circle 
              cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="6" fill="transparent" 
              strokeDasharray={251}
              initial={{ strokeDashoffset: 251 }}
              animate={{ strokeDashoffset: 251 - (251 * mainProgress) / 100 }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="text-blue-500" 
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute text-xl font-black text-white">{mainProgress}%</span>
        </div>

        <div className="flex flex-col gap-3">
          {!isSelectionMode && (
             <>
               <button 
                 onClick={(e) => {
                   e.stopPropagation();
                   onEnterLearning(subject.id);
                 }}
                 className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-600/20 active:scale-95"
               >
                 Go Learning
                 <ChevronRight size={14} />
               </button>
               <button 
                 onClick={(e) => onDelete(subject.id, e)}
                 className="p-3 text-zinc-800 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
               >
                 <Trash2 size={18} />
               </button>
             </>
          )}
          {isSelectionMode && (
            <div className={cn(
              "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all",
              isSelected ? "bg-blue-600 border-blue-500 text-white" : "border-zinc-800 text-transparent"
            )}>
              <CheckCircle2 size={16} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function XIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
