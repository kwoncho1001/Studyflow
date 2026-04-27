/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PersonaType = 'standard' | 'easy' | 'meme' | 'custom';

export interface DesignSettings {
  galleryCohesion: number;   // A. 갤러리 형성 임계치
  minGalleryVolume: number;  // B. 갤러리 최소 볼륨
  postGranularity: number;   // C. 개념글 분화 정밀도
  minPostScale: number;      // D. 개념글 최소 노드
  bindingThreshold: number;  // E. 외부 자료 접착 강도
}

export interface Subject {
  id: string;
  name: string;
  createdAt: number;
  lastStudiedAt?: number;
  persona?: PersonaType;
  customPersona?: string;
  categoryModes?: Partial<Record<MaterialType, CategoryMode>>;
  designSettings?: DesignSettings;
}

export type MaterialType = 'lecture' | 'recording' | 'exam';
export type InterpretationMode = 'selective' | 'core' | 'supplement';
export type CategoryMode = InterpretationMode | 'custom';

export interface SubjectFile {
  id: string;
  subjectId: string;
  name: string;
  type: MaterialType;
  mode: InterpretationMode;
  createdAt: number;
  totalUnits: number; // Pages for PDF, segments for TXT
  
  // Metadata for exams
  examYear?: string;
  examTerm?: string;
  examType?: string; // Midterm, Final
  grade?: string;
  parsedQuestions?: Array<{ 
    id: string; 
    questionText: string; 
    pageIndex: number;
    embedding?: number[];
    metadata?: {
      year: string;
      term: string;
      type: string;
      grade: string;
    };
  }>;
  
  // RAW transcripts for referencing
  rawTranscripts?: Array<{
    pageNumber: number;
    text: string;
  }>;
}

export interface Unit {
  id: string; // [fileId]-[subIndex]
  fileId: string;
  subjectId: string;
  index: number; // pageNumber or segmentIndex
  content: string; // Extracted/Analyzed text
  embedding?: number[];
  type: MaterialType;
  questions?: string[]; // For exam questions: questionTexts
  questionIds?: string[]; // [Year-Term-Type-QXX]
}

export interface Gallery {
  id: string;
  subjectId: string;
  name: string;
  description: string;
  keywords: string[];
  averageVector: number[];
  order: number;
}

export interface ConceptPost {
  id: string;
  galleryId: string;
  subjectId: string;
  title: string;
  content: string;
  learningObjectives: string[];
  keywords: string[];
  averageVector: number[];
  order: number;
  isQuizPost?: boolean;
  quizData?: QuizItem[];
  isLearned?: boolean;
  mappedUnits: string[]; // Array of Unit IDs
}

export interface QuizItem {
  id: string;
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  type: 'multiple' | 'short';
}

export interface ExamSession {
  id: string;
  subjectId: string;
  fileId: string;
  startTime: number;
  endTime?: number;
  answers: Record<string, string>; // questionId -> answer
  scores: Record<string, boolean>; // questionId -> isCorrect
}

export interface ChatMessage {
  id: string;
  postId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}
