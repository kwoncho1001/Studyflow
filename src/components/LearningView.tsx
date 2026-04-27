import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { SubjectFile, ConceptPost, Unit, ChatMessage } from '../types';
import { aiService } from '../lib/ai';
import { dbService } from '../lib/db';
import { cn, generateId } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, MessageSquare, Send, BookOpen, 
  HelpCircle, CheckCircle2, BrainCircuit, Check,
  FileSearch, Sparkles, ChevronRight,
  Loader2, Database, User, Bot, AlertCircle, XCircle, X,
  Search, Video, FileText, ExternalLink, Mic
} from 'lucide-react';

interface LearningViewProps {
  subjectId: string;
  postId: string;
  onBack: () => void;
  onNavigate: (id: string) => void;
}

export default function LearningView({ subjectId, postId, onBack, onNavigate }: LearningViewProps) {
  const [post, setPost] = useState<ConceptPost | null>(null);
  const [nextPost, setNextPost] = useState<ConceptPost | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [files, setFiles] = useState<Record<string, SubjectFile>>({});
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [sending, setSending] = useState(false);
  
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  
  // Quiz states
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizResults, setQuizResults] = useState<Record<number, 'correct' | 'incorrect'>>({});
  const [currentQuizIdx, setCurrentQuizIdx] = useState(0);

  const [galleryPosts, setGalleryPosts] = useState<ConceptPost[]>([]);
  const [activeTab, setActiveTab] = useState('content');

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPost();
    calculateNextPost();
    setActiveTab('content');
    setCurrentQuizIdx(0);
    window.scrollTo(0, 0);
  }, [postId]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats]);

  const calculateNextPost = async () => {
    const galleries = await dbService.getGalleries(subjectId);
    const sortedGalleries = galleries.sort((a,b) => a.order - b.order);
    
    let allPosts: ConceptPost[] = [];
    for (const g of sortedGalleries) {
      const p = await dbService.getPostsByGallery(g.id);
      allPosts.push(...p.sort((a,b) => a.order - b.order));
    }

    const midx = allPosts.findIndex(p => p.id === postId);
    if (midx !== -1 && midx < allPosts.length - 1) {
      setNextPost(allPosts[midx + 1]);
    } else {
      setNextPost(null);
    }
  };

  const loadPost = async () => {
    setLoading(true);
    const db = await dbService.getDB();
    const p = await db.get('posts', postId);
    if (!p) return;
    setPost(p);
    
    const uList: Unit[] = [];
    const fMap: Record<string, SubjectFile> = {};
    for (const uId of p.mappedUnits) {
       const u = await db.get('units', uId);
       if (u) uList.push(u);
    }
    setUnits(uList);
    
    const allFiles = await dbService.getFiles(subjectId);
    allFiles.forEach(f => fMap[f.id] = f);
    setFiles(fMap);

    const c = await dbService.getChats(postId);
    setChats(c);

    const gPosts = await dbService.getPostsByGallery(p.galleryId);
    setGalleryPosts(gPosts.sort((a, b) => a.order - b.order));

    setLoading(false);

    // If quiz post, start on quiz tab
    if (p.isQuizPost) {
       setActiveTab('quiz');
    }

    // Mark as learned on entry
    markAsLearned(p);

    // Update lastStudiedAt for the subject
    dbService.getSubjects().then(subs => {
      const sub = subs.find(s => s.id === subjectId);
      if (sub) {
        dbService.saveSubject({ ...sub, lastStudiedAt: Date.now() });
      }
    });

    // If no content, synthesize automatically
    if (!p.content) {
       handleSynthesize(p, uList, fMap);
    }
  };

  const handleSynthesize = async (p: ConceptPost, uList: Unit[], fMap: Record<string, SubjectFile>) => {
    setSynthesizing(true);
    try {
      let synthesis;
      
      // Load persona if present
      let personaStr = "고학력 전공 멘토 (High Academic Persona)";
      const sub = await dbService.getSubject(subjectId);
      if (sub?.persona) {
        if (sub.persona === 'easy') personaStr = "친근하고 쉬운 비유를 즐리는 전공 멘토 (Friendly Persona)";
        else if (sub.persona === 'meme') personaStr = "유쾌한 드립과 최신 밈을 섞어 설명하는 전공 멘토 (Meme/Cool Persona)";
        else if (sub.persona === 'custom' && sub.customPersona) personaStr = sub.customPersona;
      }

      const enrichMaterials = (unitsToEnrich: Unit[]) => {
        return unitsToEnrich.map(u => {
           const file = fMap[u.fileId];
           if (file?.type === 'exam') {
             const qId = (u.questionIds && u.questionIds[0]) ? u.questionIds[0] : `Q${u.index}`;
             return `[기출문제 ${qId}] ${u.content}`;
           }
           return u.content;
        });
      };
      
      if (p.isQuizPost) {
        // Special logic for Final Exam (isQuizPost)
        const allGalleryPosts = await dbService.getPostsByGallery(p.galleryId);
        const sortedPosts = allGalleryPosts.sort((a, b) => a.order - b.order);
        // Exclude the quiz post itself from reference list
        const referencePosts = sortedPosts.filter(x => !x.isQuizPost);
        const gallery = (await dbService.getGalleries(subjectId)).find(g => g.id === p.galleryId);
        
        // Collect all materials mapped across this gallery
        const allUnitIds = [...new Set(referencePosts.flatMap(rp => rp.mappedUnits))];
        const db = await dbService.getDB();
        const galleryUnits: Unit[] = [];
        for (const uid of allUnitIds) {
          const u = await db.get('units', uid);
          if (u) galleryUnits.push(u);
        }
        const galleryMaterials = enrichMaterials(galleryUnits);

        // Final quiz count: 10 + number of reference posts
        const questionCount = 10 + referencePosts.length;

        synthesis = await aiService.synthesizeFinalExam(
          gallery?.name || "주요 개념", 
          referencePosts, 
          galleryMaterials,
          personaStr,
          questionCount
        );
      } else {
        // Normal concept post synthesis
        const texts = enrichMaterials(uList);
        synthesis = await aiService.synthesizeConceptContent(p, texts, personaStr);
      }
      
      const updatedPost = { 
        ...p, 
        content: synthesis.content, 
        quizData: synthesis.quizData || [] 
      };
      await dbService.savePosts([updatedPost]);
      setPost(updatedPost);
    } catch (err) {
      console.error(err);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || !post || sending) return;

    setSending(true);
    const userMsg: ChatMessage = {
      id: generateId(),
      postId: post.id,
      role: 'user',
      content: input,
      createdAt: Date.now()
    };
    
    setChats(prev => [...prev, userMsg]);
    setInput('');
    await dbService.addChat(userMsg);

    try {
      const materialTexts = units.map(u => u.content);
      const aiResponse = await aiService.answerQuestion(
        userMsg.content, 
        post.content || "", 
        materialTexts, 
        "고학력 전공 멘토 (High Academic Persona)"
      );

      const botMsg: ChatMessage = {
        id: generateId(),
        postId: post.id,
        role: 'assistant',
        content: aiResponse,
        createdAt: Date.now()
      };
      
      setChats(prev => [...prev, botMsg]);
      await dbService.addChat(botMsg);
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: generateId(),
        postId: post.id,
        role: 'assistant',
        content: "AI 멘토와 연결하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        createdAt: Date.now()
      };
      setChats(prev => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  const markAsLearned = async (pToUpdate?: ConceptPost) => {
    const targetPost = pToUpdate || post;
    if (targetPost && !targetPost.isLearned) {
      const updated = { ...targetPost, isLearned: true };
      await dbService.savePosts([updated]);
      if (!pToUpdate) setPost(updated);
      
      // Update gallery posts list as well to reflect progress instantly
      setGalleryPosts(prev => prev.map(gp => gp.id === updated.id ? updated : gp));
    }
  };

  const handleQuizAnswer = (quizIdx: number, selected: string, correct: string) => {
    setQuizAnswers(prev => ({ ...prev, [quizIdx]: selected }));
    
    // 선택지에서 번호만 추출 (예: "2) 다클론 항체" -> "2")
    const selectedNum = selected.trim().split(')')[0];
    const correctNum = correct.trim().replace(/"/g, ''); // "2"와 같은 경우도 처리
    
    // 내용 비교도 수행
    const cleanSelected = selected.replace(/^\d\)\s*/, '').trim().toLowerCase();
    const cleanCorrect = correct.replace(/^\d\)\s*/, '').trim().toLowerCase();
    
    const isCorrect = selectedNum === correctNum || cleanSelected === cleanCorrect;
    
    setQuizResults(prev => ({ ...prev, [quizIdx]: isCorrect ? 'correct' : 'incorrect' }));
  };

  const progressPercent = galleryPosts.length > 0 
    ? Math.round((galleryPosts.filter(p => p.isLearned).length / galleryPosts.length) * 100) 
    : 0;

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-vh-screen py-32 space-y-4 bg-[#0A0B10]">
      <Loader2 className="animate-spin text-blue-500" size={40} />
      <p className="text-zinc-500 font-bold">개념 학습 환경 로드 중...</p>
    </div>
  );
  if (!post) return <div className="flex items-center justify-center min-h-screen text-zinc-600 font-bold bg-[#0A0B10]">Post not found.</div>;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const offset = 120;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = el.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  const navItems = [
    ...(post && !post.isQuizPost ? [{ id: 'content', label: '종합학습', icon: <BookOpen size={18} /> }] : []),
    { id: 'quiz', label: '학습확인' + (post?.isQuizPost ? '(최종)' : ''), icon: <BrainCircuit size={18} /> },
    { id: 'data', label: '학습근거데이터', icon: <Database size={18} /> },
    { id: 'action-next', label: '다음 단계 학습하기', icon: <ChevronRight size={18} /> },
  ];

  return (
    <div className="flex bg-[#0A0B10] min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-16 bottom-0 w-80 bg-[#0A0B10]/95 backdrop-blur-3xl border-r border-zinc-900 z-40 hidden lg:flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar">
          {/* Section 1: Learning Map (Tabs) */}
          <div className="space-y-4">
            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[4px] px-2">Stage Navigation</span>
            <div className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'action-next') {
                      if (nextPost) onNavigate(nextPost.id);
                    } else {
                      setActiveTab(item.id);
                      window.scrollTo({ top: 0, behavior: 'instant' });
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all group border",
                    activeTab === item.id 
                      ? "bg-blue-600/10 text-white border-blue-500/30" 
                      : (item.id === 'action-next' && !nextPost)
                        ? "opacity-30 cursor-not-allowed border-transparent text-zinc-600"
                        : "text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-800/30"
                  )}
                  disabled={item.id === 'action-next' && !nextPost}
                >
                  <span className={cn(
                    "transition-colors",
                    activeTab === item.id ? "text-blue-500" : "text-zinc-600 group-hover:text-zinc-400"
                  )}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-zinc-900/50 -mx-6" />

          {/* Section 2: Gallery Progress & Table of Contents */}
          <div className="space-y-8">
            <div className="px-2 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[4px]">Course Module</span>
                <span className="text-[12px] font-black text-blue-500">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/50">
                <div 
                  className="h-full bg-blue-600 transition-all duration-1000 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[4px] px-2 mb-4 block">Table of Contents</span>
              <div className="grid grid-cols-1 gap-1">
                {galleryPosts.map((gp, idx) => (
                  <button
                    key={gp.id}
                    onClick={() => onNavigate(gp.id)}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 rounded-2xl text-[13px] text-left transition-all border group",
                      gp.id === postId 
                        ? "bg-zinc-900 border-zinc-800 text-white shadow-xl shadow-black/40" 
                        : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 w-6 h-6 rounded-lg text-[10px] font-black flex items-center justify-center border transition-colors",
                      gp.id === postId
                        ? "bg-blue-600 border-blue-500/50 text-white"
                        : gp.isLearned 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                          : "bg-zinc-900 border-zinc-800 text-zinc-600 group-hover:border-zinc-700"
                    )}>
                      {gp.isLearned ? <Check size={12} strokeWidth={4} /> : idx + 1}
                    </div>
                    <span className={cn(
                      "font-bold leading-tight pt-0.5 transition-colors",
                      gp.id === postId ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"
                    )}>{gp.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:ml-80 relative">
        <div className="w-full lg:w-[70%] mx-auto pb-44 px-8 pt-10 animate-in fade-in duration-700">
          {/* Header Sticky */}
          <header className="sticky top-14 z-[60] bg-[#0A0B10]/95 backdrop-blur-xl border-b border-zinc-900 -mx-8 px-8 py-4 mb-16">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button 
                  onClick={onBack}
                  className="p-2.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-all text-zinc-400 border border-zinc-800"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-xl font-black text-white tracking-tighter truncate max-w-[200px] md:max-w-md">{post.title}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-blue-500 tracking-widest uppercase">Stage Lesson</span>
                    <span className="w-1 h-1 rounded-full bg-zinc-700" />
                    {post.isLearned && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 rounded-full border border-emerald-500/20 font-black">Learned</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="hidden md:flex items-center gap-3">
                 {synthesizing && (
                   <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                     <Loader2 size={12} className="animate-spin text-blue-500" />
                     <span className="text-[9px] font-black text-blue-500 uppercase">AI Processing</span>
                   </div>
                 )}
              </div>
            </div>
          </header>

          <div className="space-y-10">
            
            {/* Tab 1: 종합 학습 (Content + Q&A) */}
            {activeTab === 'content' && !post.isQuizPost && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-24"
              >
                <section id="content" className="space-y-10">
                  <div className="flex items-center gap-3 px-2">
                    <BookOpen className="text-blue-500" size={24} />
                    <h3 className="text-2xl font-black text-white tracking-tight">종합 학습</h3>
                  </div>
                  
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-[3rem] p-10 md:p-14 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-12 opacity-[0.02] pointer-events-none">
                      <BookOpen size={200} />
                    </div>
                    
                    <div className="prose prose-invert prose-blue max-w-none text-zinc-200 leading-relaxed font-normal markdown-body">
                      {post.content ? (
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{post.content}</ReactMarkdown>
                      ) : synthesizing ? (
                        <div className="flex flex-col items-center py-24 space-y-6">
                          <div className="relative">
                            <Loader2 className="animate-spin text-blue-500" size={48} />
                            <Sparkles className="absolute -top-4 -right-4 text-blue-400 animate-bounce" />
                          </div>
                          <p className="text-zinc-500 font-black tracking-tight text-xl">AI 멘토가 학습 내용을 설계하고 있습니다...</p>
                        </div>
                      ) : (
                        <div className="py-24 text-center">
                           <p className="text-zinc-600 italic font-medium">학습 내용이 비어있습니다. 근거 데이터를 바탕으로 Q&A를 진행하세요.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section id="qa" className="space-y-10">
                  <div className="flex items-center gap-3 px-2">
                    <MessageSquare className="text-indigo-400" size={24} />
                    <h3 className="text-2xl font-black text-white tracking-tight">Q&A Discussion</h3>
                  </div>
                  
                  <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-[3rem] overflow-hidden flex flex-col shadow-2xl">
                    {/* Chat Messages Area */}
                    <div className="p-8 space-y-8 min-h-[300px] max-h-[600px] overflow-y-auto custom-scrollbar bg-zinc-900/10">
                      {chats.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 opacity-30 space-y-4">
                          <BrainCircuit size={64} className="text-zinc-800" />
                          <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest text-center">
                            아직 대화가 없습니다.<br/>궁금한 점을 아래 입력창에 물어보세요!
                          </p>
                        </div>
                      ) : (
                        chats.map((chat) => {
                          const chatDate = new Date(chat.createdAt);
                          const timeStr = `${chatDate.getHours().toString().padStart(2, '0')}:${chatDate.getMinutes().toString().padStart(2, '0')}`;
                          
                          return (
                            <div 
                              key={chat.id} 
                              className={cn(
                                "flex gap-3 w-full animate-in slide-in-from-bottom-2 duration-300",
                                chat.role === 'user' ? "flex-row-reverse" : "flex-row"
                              )}
                            >
                              {/* Avatar Icon */}
                              <div className={cn(
                                "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border",
                                chat.role === 'user' 
                                  ? "bg-zinc-800 border-zinc-700 text-zinc-400" 
                                  : "bg-orange-500/10 border-orange-500/20 text-orange-400"
                              )}>
                                {chat.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                              </div>

                              {/* Message Bubble */}
                              <div className={cn(
                                "flex flex-col max-w-[85%]",
                                chat.role === 'user' ? "items-end" : "items-start"
                              )}>
                                <div className={cn(
                                  "p-5 rounded-2xl text-[14px] leading-relaxed shadow-lg relative group",
                                  chat.role === 'user' 
                                    ? "bg-zinc-800 border border-zinc-700 text-zinc-200" 
                                    : "bg-zinc-900 border border-zinc-800 text-zinc-200 prose prose-invert prose-sm max-w-none"
                                )}>
                                  {/* Timestamp Inside Bubble */}
                                  <div className="text-[10px] text-zinc-600 font-bold mb-1 font-mono tracking-tighter">
                                    {timeStr}
                                  </div>
                                  
                                  {chat.role === 'assistant' ? (
                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{chat.content}</ReactMarkdown>
                                  ) : (
                                    chat.content
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={chatBottomRef} />
                    </div>

                    {/* Integrated Chat Input */}
                    <div className="p-4 bg-[#12131A] border-t border-zinc-800/50">
                      <div className="flex items-center gap-4 bg-zinc-900/50 rounded-2xl p-2 pl-6 border border-zinc-800 group focus-within:border-blue-500/50 transition-all">
                        <input 
                          type="text" 
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          placeholder="멘토에게 이 주제에 대해 깊게 질문하기..."
                          className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-zinc-700 font-bold py-2"
                        />
                        <button 
                          onClick={() => handleSendMessage()}
                          disabled={!input.trim() || sending}
                          className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300",
                            input.trim() && !sending 
                              ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:scale-105" 
                              : "bg-zinc-800 text-zinc-600"
                          )}
                        >
                          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={20} className="-mr-0.5 mb-0.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Navigation handled by tabs */}
              </motion.div>
            )}

            {/* Tab 2: 학습 확인 (Quiz) */}
            {activeTab === 'quiz' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-12 pb-32"
              >
                {post.quizData && post.quizData.length > 0 ? (
                   <>
                    {/* Quiz Header Info */}
                    <div className="flex items-end justify-between px-2">
                       <div className="space-y-1">
                         <div className="flex items-center gap-2 text-[10px] font-black tracking-widest uppercase">
                           <span className="text-zinc-500">Question {currentQuizIdx + 1} of {post.quizData.length}</span>
                           <span className="text-orange-500">MEDIUM</span>
                         </div>
                       </div>
                       <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2 flex flex-col items-center">
                         <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest scale-75">Score</span>
                         <span className="text-lg font-black text-orange-400">
                           {Object.values(quizResults).filter(r => r === 'correct').length}/{Object.keys(quizResults).length || 1}
                         </span>
                       </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/50">
                       <motion.div 
                         className="h-full bg-gradient-to-r from-orange-400 via-yellow-300 to-emerald-400"
                         animate={{ width: `${((currentQuizIdx + 1) / post.quizData.length) * 100}%` }}
                         transition={{ duration: 0.5 }}
                       />
                    </div>

                    {/* Current Question Display */}
                    {post.quizData[currentQuizIdx] && (
                      <div className="space-y-8">
                        {/* Question Box */}
                        <div className="bg-[#12131A] border border-zinc-800 p-8 rounded-2xl flex items-start gap-5 shadow-2xl relative overflow-hidden group">
                           <div className="absolute top-0 left-0 w-1 h-full bg-orange-500 opacity-50" />
                           <div className="shrink-0 p-2 bg-orange-500/10 text-orange-400 rounded-xl">
                              <AlertCircle size={20} />
                           </div>
                           <p className="text-lg font-bold text-zinc-100 leading-snug">
                             {post.quizData[currentQuizIdx].question}
                           </p>
                        </div>

                        {/* Options List */}
                        <div className="grid grid-cols-1 gap-3">
                          {(post.quizData[currentQuizIdx].options || []).map((opt, oIdx) => {
                             const labels = ['A', 'B', 'C', 'D', 'E'];
                             const letter = labels[oIdx] || 'X';
                             const isSelected = quizAnswers[currentQuizIdx] === opt;
                             const hasResult = !!quizResults[currentQuizIdx];
                             const isCorrect = opt.replace(/^\d\)\s*/, '').trim().toLowerCase() === post.quizData![currentQuizIdx].answer.replace(/^\d\)\s*/, '').trim().toLowerCase();
                             
                             return (
                               <button 
                                 key={opt}
                                 disabled={hasResult}
                                 onClick={() => handleQuizAnswer(currentQuizIdx, opt, post.quizData![currentQuizIdx].answer)}
                                 className={cn(
                                   "w-full flex items-center gap-5 p-5 rounded-xl border-2 font-bold transition-all text-left relative overflow-hidden group/opt",
                                   !hasResult 
                                     ? "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white"
                                     : isCorrect
                                       ? "bg-emerald-500/5 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                                       : isSelected && !isCorrect
                                         ? "bg-rose-500/5 border-rose-500 text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.1)]"
                                         : "bg-zinc-900/20 border-zinc-800 text-zinc-700 opacity-40"
                                 )}
                               >
                                 <div className={cn(
                                   "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black border transition-all",
                                   !hasResult ? "bg-zinc-800 border-zinc-700 text-zinc-500 group-hover/opt:border-zinc-600 group-hover/opt:text-zinc-300" 
                                   : isCorrect ? "bg-emerald-500 border-emerald-400 text-white" 
                                   : isSelected && !isCorrect ? "bg-rose-500 border-rose-400 text-white"
                                   : "bg-zinc-800 border-zinc-800 text-zinc-600"
                                 )}>
                                   {letter}
                                 </div>
                                 <span className="flex-1 text-[15px]">{opt}</span>
                                 {hasResult && isCorrect && <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />}
                                 {hasResult && isSelected && !isCorrect && <XCircle size={18} className="text-rose-500 shrink-0" />}
                               </button>
                             );
                          })}
                        </div>

                        {/* Feedback Area */}
                        <AnimatePresence>
                          {quizResults[currentQuizIdx] && (
                            <motion.div 
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn(
                                "p-8 rounded-[1.5rem] border space-y-4 shadow-2xl",
                                quizResults[currentQuizIdx] === 'correct' 
                                  ? "bg-emerald-500/5 border-emerald-500/30" 
                                  : "bg-rose-500/5 border-rose-500/30"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center",
                                  quizResults[currentQuizIdx] === 'correct' ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                                )}>
                                   {quizResults[currentQuizIdx] === 'correct' ? <Check size={18} strokeWidth={4} /> : <X size={18} strokeWidth={4} />}
                                </div>
                                <h4 className={cn("text-xl font-black tracking-tight", quizResults[currentQuizIdx] === 'correct' ? "text-emerald-500" : "text-rose-500")}>
                                  {quizResults[currentQuizIdx] === 'correct' ? 'Correct!' : 'Not quite right'}
                                </h4>
                              </div>
                              <div className="prose prose-invert prose-sm max-w-none text-zinc-300 font-medium leading-relaxed">
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {post.quizData[currentQuizIdx].explanation}
                                </ReactMarkdown>
                              </div>
                              
                              <div className="flex justify-end pt-6">
                                <button 
                                  onClick={() => {
                                    if (currentQuizIdx < post.quizData!.length - 1) {
                                      setCurrentQuizIdx(prev => prev + 1);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    } else {
                                      // End of quiz - show finish UI
                                      setCurrentQuizIdx(999); // Marker for end
                                    }
                                  }}
                                  className="px-8 py-3 bg-orange-400 hover:bg-orange-300 text-black font-black rounded-xl transition-all shadow-lg hover:translate-y-[-2px] active:translate-y-0"
                                >
                                  {currentQuizIdx < post.quizData!.length - 1 ? 'Next Question' : 'Finish Quiz'}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Completion UI */}
                    {currentQuizIdx === 999 && (
                      <div className="py-20 text-center space-y-10 animate-in zoom-in-95 duration-700">
                         <div className="relative inline-block">
                           <div className="w-32 h-32 bg-emerald-500/10 rounded-[3rem] flex items-center justify-center text-emerald-500 border-2 border-emerald-500/20 shadow-3xl mx-auto">
                              <CheckCircle2 size={64} />
                           </div>
                           <motion.div 
                             initial={{ scale: 0 }}
                             animate={{ scale: 1 }}
                             className="absolute -top-4 -right-4 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-black font-black"
                           >
                             100%
                           </motion.div>
                         </div>
                         <div className="space-y-3">
                           <h4 className="text-5xl font-black text-white tracking-tighter uppercase whitespace-nowrap">Quiz Complete</h4>
                           <p className="text-zinc-500 font-bold italic text-xl">이 챕터의 주관적 정답 데이터를 모두 격파했습니다.</p>
                         </div>
                         <div className="flex justify-center gap-4">
                            <button 
                              onClick={() => setCurrentQuizIdx(0)}
                              className="px-8 py-4 bg-zinc-900 text-zinc-400 hover:text-white font-bold rounded-2xl border border-zinc-800 transition-all"
                            >
                              Retry Quiz
                            </button>
                            {nextPost ? (
                               <button 
                                 onClick={() => onNavigate(nextPost.id)}
                                 className="px-10 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-600/20 hover:scale-105 transition-all"
                               >
                                 Move to Next Stage
                               </button>
                            ) : (
                               <button 
                                 onClick={onBack}
                                 className="px-10 py-4 bg-zinc-800 text-white font-black rounded-2xl transition-all"
                               >
                                 Back to Roadmap
                               </button>
                            )}
                         </div>
                      </div>
                    )}
                   </>
                ) : (
                  <div className="py-32 text-center bg-zinc-900/10 border-2 border-dashed border-zinc-800 rounded-[3rem] opacity-30">
                    <BrainCircuit size={48} className="mx-auto mb-4" />
                    <p className="text-zinc-500 font-bold uppercase tracking-widest italic">Diagnostic Items Not Synchronized</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Tab 3: 학습 근거 데이터 (Materials) */}
            {activeTab === 'data' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8 pb-32"
              >
                {/* Header Information Box */}
                <div className="bg-[#12131A] border border-zinc-800 p-8 rounded-2xl flex items-start gap-6 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 opacity-50" />
                  <div className="shrink-0 p-3 bg-blue-500/10 text-blue-400 rounded-xl">
                    <FileText size={24} />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-black text-white tracking-tight">Source Materials & Evidence</h3>
                    <p className="text-zinc-500 font-medium text-sm">
                      Raw data that grounds AI responses - verify and explore the original sources
                    </p>
                  </div>
                </div>

                {/* Cosmetic Search Bar */}
                <div className="relative group">
                  <div className="absolute inset-y-0 left-6 flex items-center text-zinc-500 group-focus-within:text-blue-500 transition-colors">
                    <Search size={18} />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Search evidence sources..."
                    className="w-full bg-[#12131A]/50 border border-zinc-800 rounded-2xl pl-16 pr-8 py-5 text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-blue-500/50 transition-all font-medium shadow-inner"
                  />
                </div>
                
                <div className="grid grid-cols-1 gap-4">
                  {units.length > 0 ? units.map((u, idx) => {
                    const file = files[u.fileId];
                    
                    // Assign icons based on material type
                    let Icon = FileText;
                    if (u.type === 'recording') Icon = Mic;
                    else if (u.type === 'exam') Icon = FileText;
                    else if (u.type === 'lecture') Icon = BookOpen;

                    const isVideo = u.type === 'recording';
                    
                    // NOTE: Relevance is currently a derived/mock value based on retrieval order for UI demonstration.
                    // Future implementation will use actual vector cosine similarity scores.
                    const relevance = 98 - (idx * 2);
                    
                    return (
                      <div key={u.id} className="bg-[#12131A] border border-zinc-900 rounded-2xl p-8 flex gap-8 items-start hover:border-zinc-800 transition-all group relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        
                        {/* Type Icon */}
                        <div className={cn(
                          "shrink-0 w-14 h-14 rounded-xl flex items-center justify-center border transition-all",
                          isVideo ? "bg-zinc-800/40 border-zinc-800 text-zinc-500" : "bg-zinc-800/40 border-zinc-800 text-zinc-500"
                        )}>
                          <Icon size={24} />
                        </div>

                        {/* Content Info */}
                        <div className="flex-1 space-y-4">
                          <div className="space-y-1">
                            <h4 className="text-lg font-black text-zinc-100 tracking-tight group-hover:text-white transition-colors uppercase">
                              {file?.name || 'Unknown Source'}
                            </h4>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 tracking-widest uppercase">
                              <span>Chapter: {idx + 1}</span>
                              <span>•</span>
                              <span>
                                {u.type === 'exam' ? 'Question context' : isVideo ? `Timestamp: ${Math.floor(u.index / 60)}:${(u.index % 60).toString().padStart(2, '0')}` : `Page ${u.index + 1}`}
                              </span>
                            </div>
                          </div>

                          <p className="text-zinc-400 text-[14px] leading-relaxed line-clamp-3 font-medium">
                            {u.content}
                          </p>

                          <button className="flex items-center gap-2 text-[11px] font-black text-blue-500/80 hover:text-blue-400 uppercase tracking-widest transition-colors">
                            <span>View full source</span>
                            <ExternalLink size={12} />
                          </button>
                        </div>

                        {/* Relevance Indicator */}
                        <div className="shrink-0 flex flex-col items-center justify-center gap-2 pr-2">
                           <div className="text-[10px] font-black text-zinc-700 uppercase tracking-widest scale-75">Relevance</div>
                           <div className="relative w-12 h-12 flex items-center justify-center">
                              <svg className="w-full h-full -rotate-90">
                                <circle 
                                  cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" fill="transparent"
                                  className="text-zinc-900"
                                />
                                <circle 
                                  cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" fill="transparent"
                                  strokeDasharray={126}
                                  strokeDashoffset={126 - (126 * Math.max(relevance, 60)) / 100}
                                  className="text-blue-500 transition-all duration-1000"
                                />
                              </svg>
                              <span className="absolute text-[11px] font-black text-blue-400">{relevance}%</span>
                           </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="py-32 text-center bg-zinc-900/10 border-2 border-dashed border-zinc-800 rounded-3xl opacity-30">
                      <Database size={48} className="mx-auto mb-4 text-zinc-700" />
                      <p className="text-zinc-500 font-bold uppercase tracking-widest italic tracking-[3px]">Evidence Matrix Empty</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>

          {/* Remove duplicate floating chat input if any */}
        </div>
      </div>
    </div>
  );
}
