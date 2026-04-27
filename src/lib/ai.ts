import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable = 
        error.message?.includes('503') || 
        error.message?.includes('429') ||
        error.message?.includes('UNAVAILABLE') ||
        error.status === 'UNAVAILABLE';

      if (isRetryable && i < maxRetries) {
        const waitTime = Math.pow(2, i) * 1000;
        console.warn(`AI Service Busy (Attempt ${i + 1}/${maxRetries + 1}). Retrying in ${waitTime}ms...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Sanitizes AI response to prevent repetition hallucinations (e.g., thousands of <br/> tags)
 */
function sanitizeResponse(text: string | null | undefined): string {
  if (!text) return '';
  
  // 1. Detect and collapse excessive HTML breaks or repetitive whitespace/newline patterns
  let sanitized = text.replace(/(\s*<br\s*\/?>\s*|\s*\n\s*){5,}/gi, '\n\n');
  
  // 2. Collapse excessive consecutive same characters
  sanitized = sanitized.replace(/(.)\1{30,}/g, '$1$1$1');

  // 3. NEW: Detect and collapse phrase-level repetition (e.g., repeating medical terms)
  // This looks for repetitive chunks of text and collapses them to prevent token explosion
  sanitized = sanitized.replace(/(.{4,200}?)\1{10,}/gs, '$1$1$1');
  
  return sanitized.trim();
}

export const aiService = {
  // Step 1: Information Pool (Deep Multimodal Transcription)
  async transcribePage(imageBuffer: ArrayBuffer, type: 'lecture' | 'exam'): Promise<string> {
    const base64Data = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const prompt = type === 'lecture' 
      ? `당신은 대학 교수님입니다. 이 강의 슬라이드의 내용을 하나의 통합된 마크다운 문서로 완벽히 전사하십시오.
         
         [전사 및 정제 지침 - 매우 중요]:
         1. 페이지 상단부터 하단까지 순서대로 스캔하며 의미 있는 학술 정보를 텍스트 데이터로 변환하십시오.
         2. **노이즈 및 워터마크 무시**: 문서 배경에 반복되는 특정 단어, 기관명, 저작권 문구, 혹은 의미 없이 수십 번 반복되는 텍스트가 있다면 이는 무시하고 본문 내용에만 집중하십시오.
         3. OCR을 넘어 이미지, 도표, 그래프가 나타나면 해당 위치에 "**이미지 설명:** {내용의 학술적/논리적 분석}" 형식을 삽입하여 시각 정보를 언어화하십시오.
         4. 수식은 반드시 LaTeX($...$)를 사용하십시오.
         5. 모든 답변은 한국어(KOREAN)로 작성하며, 메타 설명 없이 바로 본론 마크다운을 출력하십시오.`
      : `당신은 기출문제 물리적 전사 전문가입니다. 이 시험지 페이지의 모든 내용을 누락 없이 마크다운 문서로 전사하십시오.
         
         [필수 지침 - 위반 시 치명적 오류]:
         1. **배경 노이즈 무시**: 문제 내용과 상관없이 페이지 전체에 깔려 있는 반복적인 워터마크나 배경 텍스트는 전사하지 마십시오.
         2. **절대 요약하지 마십시오**: 문제 번호, 지문, 선택지(①~⑤)를 그대로 전사하십시오.
         3. **다단(Multi-column) 인식**: 왼쪽/오른쪽 단 순서로 전사하십시오.
         4. 수식은 반드시 LaTeX($...$)를 사용하십시오.
         5. **시각 정보의 언어화**: 화학 구조식, 분자 모델, 도표, 그래프가 나타나면 **절대 이미지 링크나 플레이스홀더([이미지] 등)를 사용하지 마십시오.** 대신 이를 상세한 텍스트 설명(예: "메틸기가 치환된 벤젠 고리", "Fisher 투영도에서의 특정 구조" 등)이나 학술적 분석 내용으로 완벽히 변환하여 문항 내용에 포함시키십시오.
         6. 모든 답변은 한국어(KOREAN)로 작성하며, 메타 설명 없이 바로 본문 텍스트만 출력하십시오.`;

    // 기출문제 전사 시에만 프리뷰 모델 사용
    const model = type === 'exam' ? "gemini-3.1-flash-lite-preview" : "gemini-2.5-flash-lite";

    const response = await withRetry(() => ai.models.generateContent({
      model: model,
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/png" } },
            { text: prompt }
          ]
        }
      ]
    }));

    return sanitizeResponse(response.text);
  },

  // Step 3: AI-driven Paragraph Segmentation for lecture chunks
  async segmentLectureChunk(text: string): Promise<string[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `당신은 강의 자료 정제 및 구조화 전문가입니다. 제공된 강의 텍스트 청크를 분석하여 불필요한 요소를 제거하고 의미 있는 단락들로 나누십시오.

      [지침]:
      1. **노이즈 제거**: 목차(Table of Contents), 저작권 공지, 페이지 번호, 단순 반복 문구 등 학습과 직접적 관련이 없는 메타데이터를 삭제하십시오.
      2. **의미적 단락 구분**: 텍스트를 논리적인 주제 변화에 따라 단락(Paragraph) 배열로 나누십시오.
      3. **원본 보존**: 핵심 학술 내용, 수식(LaTeX), 이미지 설명 등은 절대 요약하지 말고 그대로 보존하십시오.
      4. 모든 출력은 한국어(KOREAN)로 작성하십시오.
      
      결과는 각각의 단락을 담은 JSON 문자열 배열 형태로 반환하십시오.
      
      [강의 텍스트 청크]:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // Step 3-1: Strong Summary Mode for lecture chunks
  async segmentLectureChunkStrongSummary(text: string): Promise<string[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `당신은 강의 자료 핵심 요약 전문가입니다. 제공된 텍스트가 너무 방대하여 처리에 실패했습니다. 핵심 내용 위주로 강하게 요약하여 구조화하십시오.

      [지침]:
      1. **강력한 요약**: 부수적인 예시나 반복되는 설명을 과감히 줄이고 핵심 원리와 데이터 위주로 정리하십시오.
      2. **구조화**: 의미 있는 단락들로 나누어 가독성을 높이십시오.
      3. **수식 보존**: 수식($...$)은 가급적 보존하십시오.
      4. 모든 출력은 한국어(KOREAN)로 작성하십시오.
      
      결과는 각각의 단락을 담은 JSON 문자열 배열 형태로 반환하십시오.
      
      [강의 텍스트 청크]:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // Step 2: Global Context Determination (Metadata Extraction)
  async determineGlobalMetadata(rawTextPool: string, filename: string): Promise<{ year: string; term: string; type: string; grade: string }> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `당신은 시험지 정보 분석 전문가입니다. 제공된 텍스트와 파일명을 바탕으로 시험의 연도, 학기, 종류, 대상 학년을 결정하십시오.
      
      [지침]:
      - 연도(year): 4자리 숫자 (예: 2025)
      - 학기(term): 1학기, 2학기, 여름학기, 겨울학기 중 선택
      - 종류(type): 중간고사, 기말고사, 퀴즈, 기타 중 선택
      - 학년(grade): 해당되는 경우 (예: 3학년), 없으면 빈 문자열
      - 파일명과 본문 텍스트 중 더 명확한 정보를 우선하십시오.
      
      Filename: ${filename}
      Content Pool (Page 1):
      ${rawTextPool}
      
      Return JSON: { "year": "20XX", "term": "X학기", "type": "중간/기말고사", "grade": "X학년" }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            year: { type: Type.STRING },
            term: { type: Type.STRING },
            type: { type: Type.STRING },
            grade: { type: Type.STRING }
          },
          required: ['year', 'term', 'type', 'grade']
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '{}');
  },

  // Step 3: Logical Synthesis (Question Extraction)
  async synthesizeExamQuestions(unifiedTranscription: string, globalMetadata: any): Promise<Array<{ id: string, text: string }>> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[시험 문제 파싱]: 당신은 시험 문제 분석 전문가입니다. 
      제공된 통합 전사본에서 시험 문항들을 추출하여 정리하십시오.
      
      [파싱 규칙]:
      1. 각 문항은 Q1., Q2., Q3. 와 같이 'Q' 접두사와 숫자를 포함한 번호로 시작하십시오.
      2. 각 문항 내에는 문제 내용과 함께 모든 객관식 선지(예: 1) 2) 3) 4) 5) 또는 가) 나) 다) 라))를 누락 없이 포함하십시오.
      3. 절대 문제 자체를 요약하지 말고, 원문의 내용을 그대로 명확히 보존하십시오.
      4. 문항 번호 이외의 다른 메타데이터(연도, 학기 등)는 제외하십시오.
      5. JSON 형식을 요구하지 않으며, 순수 Markdown 텍스트로만 출력하십시오.
      
      [분석할 자료]:
      ${unifiedTranscription}`,
    }));

    const rawText = response.text || "";
    if (!rawText) return [];

    // Markdown 파싱: Q1. 형식을 기준으로 문항 분할
    const questionBlocks = rawText.split(/Q\d+\.\s*/).filter(block => block.trim().length > 0);
    
    return questionBlocks.map((text, index) => ({
      id: `[${globalMetadata.year}-${globalMetadata.term}-${globalMetadata.type}-Q${String(index + 1).padStart(2, '0')}]`,
      text: text.trim()
    }));
  },

  // NEW: Academic Q&A with context grounding
  async answerQuestion(userQuestion: string, postContent: string, materials: string[], persona: string): Promise<string> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[Academic Q&A]: 당신은 ${persona}입니다.
      
      [Context]
      학습 본문 내용:
      ${postContent}
      
      원천 근거 데이터:
      ${materials.length > 0 ? materials.join('\n\n---\n\n') : 'No raw materials provided.'}
      
      [User Question]
      ${userQuestion}
      
      [Instructions]
      1. 학생의 질문에 대해 제공된 '학습 본문 내용'과 '원천 근거 데이터'를 바탕으로만 답변하십시오.
      2. 본인의 페르소나(${persona}) 성격과 말투를 엄격히 유지하십시오.
      3. 제공된 자료에 없는 내용을 물어볼 경우, "현재 제공된 학습 자료로는 확인이 어렵지만..." 이라고 답변을 시작하고, 조언을 제공하되 출처가 외부에 있음을 명시하십시오.
      4. 답변은 한국어로 작성하며 마크다운을 활용하십시오. 수식은 $...$을 사용합니다.`,
    }));

    return sanitizeResponse(response.text) || "죄송합니다. 답변을 생성하는 중에 문제가 발생했습니다.";
  },

  // NEW: Neural Grading for Exam Answers
  async gradeExamAnswer(question: string, userAnswer: string): Promise<{ isCorrect: boolean; critique: string }> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `당신은 대학 학부생의 답변을 심사하는 인공지능 교수입니다.
                제공된 문제와 학생의 답변을 분석하여 정답 여부를 판정하고, 논리적 완성도에 대한 비평을 남기십시오.
                
                [평가 지침]:
                1. 학생의 답변이 문제의 핵심 요구사항을 충족했는지 엄격히 판단하십시오.
                2. 비평(critique)은 매우 짧고 통찰력 있게(1-2문장) 작성하십시오.
                3. 모든 출력은 한국어로 작성하십시오.
                
                Question: ${question}
                User Answer: ${userAnswer}
                
                Return JSON: { "isCorrect": boolean, "critique": "short critique text" }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCorrect: { type: Type.BOOLEAN },
            critique: { type: Type.STRING }
          },
          required: ['isCorrect', 'critique']
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '{ "isCorrect": false, "critique": "Neural connection timeout." }');
  },

  // Multimodal Analysis for PDF pages (Legacy/Simplified)
  async analyzePage(imageBuffer: ArrayBuffer, type: 'lecture' | 'exam'): Promise<any> {
    return this.transcribePage(imageBuffer, type);
  },

  // AI-driven refinement and segmentation for recordings
  async segmentRecording(text: string): Promise<string[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[직접 편집 모드]: 당신은 강의 녹음 스크립트 정제 및 구조화 전문가입니다.
      제공된 강의 내용을 분석하여 가독성이 높고 논리적인 단락들로 정제하십시오.
      **최종 결과물은 반드시 한국어(KOREAN)로만 작성하십시오.**
      **절대 요약하지 마십시오. 시작 부분에 개요나 요약을 추가하지 마십시오.**
      
      [필터링 가이드라인]:
      - 삭제: 출석 체크, 학습 일정/진도 공지, 잡담, 행정 안내 등 학습 내용과 관련 없는 부분.
      - 유지: 실제 교수 내용, 학술 이론, 공식, 강의 예시, 시험 관련 팁 및 힌트.
      
      [정제 가이드라인]:
      - 추임새 제거: "어", "음", "이제", "그" 등 불필요한 필러 단어를 삭제하십시오.
      - 오타 교정: 음성 인식 오류나 말실수를 문맥에 맞는 정확한 기술 용어로 교정하십시오.
      - 깊이 보존: 학술적 내용의 깊이와 세부 사항을 절대 훼손하지 마십시오.
      - 논리적 구분: 주제의 변화에 따라 논리적인 단락(배열의 문자열)으로 나누십시오.
      
      결과물은 각 문자열이 의미 있는 단락인 JSON 배열 형식으로 반환하십시오.
      
      강의 스크립트 세그먼트:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // AI-driven refusal and segmentation for lectures (with summarization allowed)
  async segmentLecturePageWithSummary(text: string): Promise<string[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[요약 및 단순화 모드]: 당신은 강의 자료 정제 전문가입니다.
      제공된 강의 내용을 가독성 좋고 깔끔하게 정제하십시오.
      **모든 결과물은 반드시 한국어(KOREAN)로 작성하십시오.**
      **이 모드에서는 효율성을 위한 요약을 허용합니다.**
      
      [정제 가이드라인]:
      - 너무 길고 반복적인 부분은 논리성을 유지하며 핵심 위주로 요약하십시오.
      - 삭제: 출결 확인, 공지사항, 잡담 등 불필요한 요소.
      - 유지: 핵심 교수 내용, 학술 이론, 수식 및 공식.
      - 구조화: 논리적 흐름에 따라 의미 있는 단락들로 구분하십시오.
      
      결과물은 JSON 문자열 배열로 반환하십시오.
      
      강의 내용:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // Embedding Generation
  async getEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const response = await withRetry(() => ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [{ parts: [{ text }] }]
    }));

    const values = (response as any).embedding?.values || (response as any).embeddings?.[0]?.values || [];
    // Rounding to 4 decimal places for optimization as requested
    return values.map(v => Math.round(v * 10000) / 10000);
  },

  // Curriculum Design - Phase 1: Gallery Generation
  async generateGalleries(clusterTexts: string[]): Promise<any[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[인지적 스캐폴딩]: 제공된 학습 자료 클러스터를 분석하여 고수준의 커리큘럼(갤러리)을 설계하십시오.
      **이름, 설명, 키워드 등 모든 결과물은 반드시 한국어(KOREAN)로 작성하십시오.**
      각 갤러리는 학습 범위에 대한 논리적 경계를 정의해야 합니다.
      각 클러스터에 대해 다음 정보를 제공하십시오:
      - name: 주요 주제의 제목
      - description: 상세 학습 범위와 맥락 설명
      - keywords: 핵심 전공 용어 리스트
      
      클러스터 데이터:
      ${clusterTexts.map((t, i) => `클러스터 ${i}: ${t.slice(0, 2000)}`).join('\n\n')}
      
      JSON 배열 형식으로 반환하십시오.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['name', 'description', 'keywords']
          }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // Concept Post Generation
  async generateConceptPosts(galleryInfo: string, clusterTexts: string[]): Promise<any[]> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[상세 단계별 설계]: 다음 갤러리 문맥 내에서 구체적인 개념 포스트(상세 학습 단위)를 설계하십시오.
      갤러리 정보: ${galleryInfo}
      
      **제목, 학습 목표, 키워드 등 모든 결과물은 반드시 한국어(KOREAN)로 작성하십시오.**
      각 하위 클러스터에 대해 다음을 제공하십시오:
      - title: 구체적인 세부 주제 제목
      - learningObjectives: 마스터해야 할 학습 목표 리스트
      - keywords: 필수 학술 용어 리스트
      
      하위 클러스터 데이터:
      ${clusterTexts.map((t, i) => `하위 클러스터 ${i}: ${t.slice(0, 2000)}`).join('\n\n')}
      
      JSON 배열 형식으로 반환하십시오.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              learningObjectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['title', 'learningObjectives', 'keywords']
          }
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    return JSON.parse(sanitizedText || '[]');
  },

  // Final Synthesis for Concept Post Content
  async synthesizeConceptContent(postInfo: any, materials: string[], persona: string): Promise<any> {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[직접 편집 모드]: 당신은 ${persona} 입니다. 
      제공된 자료들을 논리적 흐름이 완벽하고 학술적 수준이 높은 하나의 통합 학습 가이드로 재구성하십시오.
      
      [출력 규칙 - 반드시 준수]:
      1. 결과물은 Markdown 형식으로만 작성하십시오.
      2. 구조 분할을 위해 반드시 아래의 구분자를 명확히 사용하십시오.
         ## [CONCEPT_CONTENT]
         (여기에 학습 가이드 본문을 작성)
         
         ## [QUIZ_SECTION]
         (여기에 Q1., Q2. 형식으로 퀴즈 문항을 작성)
      3. 퀴즈 문항은 각 문제 시작 부분에 Q1., Q2. 와 같이 고유 번호를 붙이고, 아래 예시처럼 구성하십시오.
         Q1. 문제 내용?
         1) 선지1 2) 선지2 3) 선지3 4) 선지4
         정답: 1
         해설: 해설 내용
      
      [학습 자료]:
      ${materials.join('\n\n---\n\n')}
      
      학습 내용 작성 시작:`,
    }));

    const rawText = response.text || "";
    
    // Markdown 파싱: [CONCEPT_CONTENT]와 [QUIZ_SECTION] 기준으로 본문과 퀴즈 분할
    const parts = rawText.split('## [QUIZ_SECTION]');
    const content = parts[0].replace('## [CONCEPT_CONTENT]', '').trim();
    const quizRaw = parts[1] || "";
    
    // 퀴즈 파싱: Q1. 기준으로 분할
    const quizBlocks = quizRaw.split(/Q\d+\.\s*/).filter(block => block.trim().length > 0);
    
    const quizData = quizBlocks.map(block => {
      // 아주 간단한 정규식으로 정답/해설 분리 시도
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const question = lines[0]; // 첫 줄은 문제
      const answerMatch = block.match(/정답:\s*(\d+)/i);
      const explanationMatch = block.match(/해설:\s*(.*)/is);
      
      return {
        question,
        options: lines.filter(l => /^\d+\)/.test(l)),
        answer: answerMatch ? answerMatch[1] : "",
        explanation: explanationMatch ? explanationMatch[1].trim() : ""
      };
    });

    return { content, quizData };
  },

  // Synthesis for Final Exam (Gallery Summary)
  async synthesizeFinalExam(galleryName: string, allPosts: any[], materials: string[], persona: string, questionCount: number): Promise<any> {
    const postListText = allPosts.map((p, idx) => `[개념글 ${idx + 1}] ${p.title}`).join('\n');
    
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `[최종 시험 설계]: 당신은 ${persona} 입니다. 
      '${galleryName}' 주제를 마무리하는 최종 마스터리 테스트를 설계하십시오.
      
      현재 갤러리에 포함된 개념들의 목록:
      ${postListText}
      
      [참조 근거 자료]:
      ${materials.join('\n\n---\n\n')}
      
      [시험 설계 가이드라인]:
      1. 종합적 검증: 개별 소주제가 아닌 갤러리 전체의 핵심 맥락을 관통하는 문제를 구성하십시오.
      2. 문항 수: 총 **${questionCount}개**의 고품질 문항을 생성하십시오.
      3. 학습 복습 가이드: 각 문제의 'explanation' 필드에 정답 해설 뿐만 아니라, 오답 시 위 개념들의 목록 중 어떤 개념글(번호와 제목)을 다시 복습해야 하는지 반드시 명시하십시오. (예: "만약 이 문제를 틀렸다면 [개념글 2] ~~~를 다시 확인해보세요.")
      4. 고난도 사고: 단순 암기가 아닌 개념 간의 연결 관계, 전제 조건, 반례 등을 묻는 통합적 사고 문항을 포함하십시오.
      
      [출력]:
      - 본문(content): 본 갤러리의 학습을 마무리하는 격려의 말과 최종 테스트의 목적(총괄 평가)에 대한 짧은 안내.
      - 퀴즈(quizData): 정확히 ${questionCount}개의 문항.
      
      **모든 내용은 반드시 한국어로 작성하십시오.**
      반드시 유효한 JSON 형식만 반환하십시오.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            quizData: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  answer: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ['question', 'answer', 'explanation']
              }
            }
          },
          required: ['content', 'quizData']
        }
      }
    }));

    const sanitizedText = sanitizeResponse(response.text);
    try {
      return JSON.parse(sanitizedText || '{}');
    } catch (err) {
      console.error("Synthesize Final Exam JSON Parse Error:", sanitizedText);
      return { content: sanitizedText, quizData: [] }; 
    }
  }
};
