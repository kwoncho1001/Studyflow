import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ClipboardList, Layers, RefreshCw, Sparkles, Layout, ArrowLeft, Settings2, Book, Star, Trophy, Target, Zap, Lock, CheckCircle2 } from 'lucide-react';
import { dbService } from '../lib/db';
import { SubjectFile, ConceptPost, Gallery } from '../types';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface CurriculumViewProps {
  subjectId: string;
  onEnterPost: (id: string) => void;
  onEnterExam: (id?: string) => void;
  onBackToMaterials: () => void;
  onRegenerate: () => void;
  isDesigning?: boolean;
  refreshCounter?: number;
}

export default function CurriculumView({ subjectId, onEnterPost, onEnterExam, onBackToMaterials, onRegenerate, isDesigning, refreshCounter }: CurriculumViewProps) {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [posts, setPosts] = useState<Record<string, ConceptPost[]>>({});
  const [examFiles, setExamFiles] = useState<SubjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<ConceptPost | null>(null);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const [stats, setStats] = useState({ xp: 1250, streak: 12, gems: 550 });

  useEffect(() => {
    loadCurriculum();
  }, [subjectId, refreshCounter]);

  const loadCurriculum = async () => {
    setLoading(true);
    const [g, f] = await Promise.all([
      dbService.getGalleries(subjectId),
      dbService.getFiles(subjectId)
    ]);
    
    const sortedGalleries = g.sort((a,b) => a.order - b.order);
    setGalleries(sortedGalleries);
    setExamFiles(f.filter(x => x.type === 'exam'));
    
    const pMap: any = {};
    for (const gallery of g) {
      const p = await dbService.getPostsByGallery(gallery.id);
      pMap[gallery.id] = p.sort((a,b) => a.order - b.order);
    }
    setPosts(pMap);
    setLoading(false);
  };

  if (loading) return null;

  if (galleries.length === 0 && examFiles.length === 0) {
    return null; // Handle empty state in parent to show CTA
  }

  return (
    <div className="relative min-h-screen pb-32 overflow-x-hidden bg-[#0A0B10]">
      {/* Gamified Top Bar */}
      <div className="sticky top-0 z-[100] w-full bg-[#0A0B10]/95 backdrop-blur-xl border-b border-zinc-900 px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button 
                onClick={onBackToMaterials}
                className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-xl font-black text-white tracking-tighter uppercase">Study Journey</h2>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-blue-600/10 px-3 py-1.5 rounded-full border border-blue-500/20">
                <Zap size={14} className="text-blue-500 fill-blue-500" />
                <span className="text-xs font-black text-blue-500">{stats.streak}</span>
              </div>
              <div className="flex items-center gap-2 bg-pink-600/10 px-3 py-1.5 rounded-full border border-pink-500/20">
                 <Trophy size={14} className="text-pink-500" />
                 <span className="text-xs font-black text-pink-500">{stats.xp}</span>
              </div>
              <button 
                 onClick={onRegenerate}
                 disabled={isDesigning}
                 className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-colors disabled:opacity-30"
              >
                 <RefreshCw size={18} className={cn(isDesigning && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* Unit Selector (Top Tabs) */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {galleries.map((g, idx) => (
              <button
                key={g.id}
                onClick={() => setActiveGalleryIndex(idx)}
                className={cn(
                  "flex-none px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeGalleryIndex === idx 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                    : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800"
                )}
              >
                Unit {idx + 1}
              </button>
            ))}
            {examFiles.length > 0 && (
              <button
                onClick={() => setActiveGalleryIndex(galleries.length)}
                className={cn(
                  "flex-none px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeGalleryIndex === galleries.length 
                    ? "bg-yellow-600 text-white shadow-lg shadow-yellow-600/20" 
                    : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800"
                )}
              >
                Final Stage
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto pt-12 px-6">
        {activeGalleryIndex < galleries.length ? (
          <div className="space-y-16">
            {/* Unit Info Section */}
            <motion.div 
              key={galleries[activeGalleryIndex].id + "header"}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "relative z-10 w-full p-8 rounded-[2rem] border-b-4 mb-20",
                activeGalleryIndex % 3 === 0 ? "bg-emerald-600 border-emerald-700 shadow-xl shadow-emerald-900/20" :
                activeGalleryIndex % 3 === 1 ? "bg-blue-600 border-blue-700 shadow-xl shadow-blue-900/20" :
                "bg-purple-600 border-purple-700 shadow-xl shadow-purple-900/20"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-[11px] font-black text-white/60 uppercase tracking-widest opacity-80">Unit {activeGalleryIndex + 1}</p>
                  <h3 className="text-3xl font-black text-white px-0.5 tracking-tighter leading-none">{galleries[activeGalleryIndex].name}</h3>
                  <p className="text-white/90 text-sm font-medium mt-3 leading-relaxed max-w-xl">{galleries[activeGalleryIndex].description}</p>
                </div>
                <div className="w-14 h-14 bg-black/20 rounded-2xl flex-none flex items-center justify-center text-white backdrop-blur-md">
                   <Book size={28} />
                </div>
              </div>
            </motion.div>

            {/* Stage Path */}
            <div className="flex flex-col items-center pb-24 relative">
              {posts[galleries[activeGalleryIndex].id]?.map((post, pIdx) => {
                const currentGalleryPosts = posts[galleries[activeGalleryIndex].id] || [];
                const totalStages = currentGalleryPosts.length;
                // Calculate horizontal winding (The "Path" feeling)
                const amplitude = 80;
                const frequency = 0.8;
                const xOffset = Math.sin(pIdx * frequency) * amplitude;
                const nextXOffset = Math.sin((pIdx + 1) * frequency) * amplitude;
                
                // Calculate precise angle to the next node
                // Vertical distance between centers is approx 176px (Node 80px + py-12(48px)*2)
                const dy = 176;
                const dx = nextXOffset - xOffset;
                const distance = Math.sqrt(dx * dx + dy * dy);
                // Note: CSS rotation clockwise from top means bottom swings left. We need it to swing right when dx > 0, so negate the angle.
                const angle = -Math.atan2(dx, dy) * (180 / Math.PI);
                
                return (
                  <div 
                    key={post.id} 
                    className="relative flex flex-col items-center w-full py-12"
                  >
                    <div 
                      className="flex items-center gap-8 w-full max-w-xl transition-transform duration-500 ease-out"
                      style={{ transform: `translateX(${xOffset}px)` }}
                    >
                      {/* Stage Node */}
                      <div className="relative flex-none">
                        <motion.button
                          onClick={() => onEnterPost(post.id)}
                          whileHover={{ scale: 1.1, rotate: 5 }}
                          whileTap={{ scale: 0.9 }}
                          className={cn(
                            "relative w-20 h-20 rounded-[2rem] flex items-center justify-center shadow-2xl transition-all z-10",
                            post.isLearned 
                              ? "bg-emerald-500 border-b-8 border-emerald-700 active:border-b-0"
                              : post.isQuizPost 
                                ? "bg-orange-500 border-b-8 border-orange-700 active:border-b-0" 
                                : "bg-blue-500 border-b-8 border-blue-700 active:border-b-0"
                          )}
                        >
                          {post.isLearned ? <CheckCircle2 size={32} className="text-white" /> : 
                           post.isQuizPost ? <Sparkles size={32} className="text-white fill-white" /> : 
                           <span className="text-white font-black text-2xl tracking-tighter">{pIdx + 1}</span>}
                          
                          {/* Indicator for first stage of unit */}
                          {pIdx === 0 && (
                             <div className="absolute -top-3 -right-3 w-8 h-8 bg-blue-400 rounded-full border-4 border-[#0A0B10] flex items-center justify-center shadow-lg">
                               <Zap size={14} className="text-white fill-white" />
                             </div>
                          )}
                        </motion.button>

                        {/* Path segment (Dotted Connector) */}
                        {pIdx < totalStages - 1 && (
                          <div 
                            className="absolute top-[40px] left-1/2 -translate-x-1/2 pointer-events-none"
                            style={{ 
                              width: '4px',
                              height: `${distance}px`,
                              transform: `rotate(${angle}deg)`,
                              transformOrigin: 'top center',
                              zIndex: 0
                            }}
                          >
                             <div className="w-full h-full border-l-[4px] border-dashed border-zinc-800/80" />
                          </div>
                        )}
                      </div>

                      {/* Stage Details (Horizontal) */}
                      <div className="flex-1 space-y-1 pr-12">
                        <h4 className="text-lg font-black text-white tracking-tight leading-tight group-hover:text-blue-500 transition-colors">
                          {post.title}
                        </h4>
                        <div className="flex items-center gap-3">
                           <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                             Lesson {pIdx + 1}
                           </span>
                           <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                             +35 XP
                           </span>
                        </div>
                        <p className="text-zinc-500 text-xs leading-relaxed line-clamp-2 max-w-sm font-medium italic">
                          {post.learningObjectives[0]}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Final Exam Section (When activeGalleryIndex === galleries.length) */
          <motion.div 
            key="final-stage"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-12 text-center pb-32"
          >
             <div className="w-24 h-24 rounded-[2rem] bg-yellow-500 border-b-8 border-yellow-700 flex items-center justify-center text-white shadow-2xl shadow-yellow-600/20">
                <Trophy size={48} />
             </div>
             <div className="space-y-3">
               <h3 className="text-5xl font-black text-white tracking-tighter uppercase">Final Stage</h3>
               <p className="text-zinc-400 font-medium text-lg">기출문제 데이터를 통해 실전 감각을 완성하세요.</p>
             </div>

             <div className="w-full max-w-2xl grid grid-cols-1 gap-6 pt-8 text-left">
                {examFiles.map(file => (
                  <button 
                    key={file.id} 
                    onClick={() => onEnterExam(file.id)}
                    className="group bg-zinc-900/50 border border-zinc-800 rounded-[2rem] p-8 flex items-center justify-between hover:bg-zinc-900 hover:border-yellow-600/50 transition-all border-b-8 active:border-b-0 active:translate-y-2"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 rounded-[1.25rem] bg-yellow-600/10 border border-yellow-500/20 flex items-center justify-center text-yellow-500 group-hover:bg-yellow-600 group-hover:text-white transition-all">
                        <ClipboardList size={28} />
                      </div>
                      <div>
                        <h4 className="font-black text-xl text-white group-hover:text-yellow-500 transition-colors">
                          {file.examYear} {file.examTerm} {file.examType}
                        </h4>
                        <p className="text-[11px] text-zinc-500 font-black uppercase tracking-widest mt-1">{file.totalUnits} Questions Analyzed</p>
                      </div>
                    </div>
                    <div className="w-12 h-12 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-700 group-hover:border-yellow-500 group-hover:text-yellow-500 transition-all">
                       <ChevronRight size={20} />
                    </div>
                  </button>
                ))}
             </div>
          </motion.div>
        )}
      </div>

      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-10">
         <div className="absolute top-[20%] left-[-10%] w-[500px] h-[500px] bg-blue-600 rounded-full blur-[150px]" />
         <div className="absolute bottom-[20%] right-[-10%] w-[500px] h-[500px] bg-emerald-600 rounded-full blur-[150px]" />
      </div>
    </div>
  );
}
