import { openDB, IDBPDatabase } from 'idb';
import { Subject, SubjectFile, Unit, Gallery, ConceptPost, ChatMessage, ExamSession } from '../types';

const DB_NAME = 'StudyFlowDB';
const DB_VERSION = 2;

export async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('subjects')) {
        db.createObjectStore('subjects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'id' });
        store.createIndex('subjectId', 'subjectId');
      }
      if (!db.objectStoreNames.contains('units')) {
        const store = db.createObjectStore('units', { keyPath: 'id' });
        store.createIndex('subjectId', 'subjectId');
        store.createIndex('fileId', 'fileId');
      }
      if (!db.objectStoreNames.contains('galleries')) {
        const store = db.createObjectStore('galleries', { keyPath: 'id' });
        store.createIndex('subjectId', 'subjectId');
      }
      if (!db.objectStoreNames.contains('posts')) {
        const store = db.createObjectStore('posts', { keyPath: 'id' });
        store.createIndex('subjectId', 'subjectId');
        store.createIndex('galleryId', 'galleryId');
      }
      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id' });
        store.createIndex('postId', 'postId');
      }
      if (!db.objectStoreNames.contains('examSessions')) {
        const store = db.createObjectStore('examSessions', { keyPath: 'id' });
        store.createIndex('subjectId', 'subjectId');
      }
      if (!db.objectStoreNames.contains('rawTranscripts')) {
        const store = db.createObjectStore('rawTranscripts', { keyPath: 'id' });
        store.createIndex('fileId', 'fileId');
      }
    },
  });
}

export const dbService = {
  // DB access
  getDB: () => getDB(),

  // Raw Transcripts
  async addRawTranscripts(fileId: string, transcripts: Array<{ pageNumber: number; text: string }>) {
    const db = await getDB();
    const tx = db.transaction('rawTranscripts', 'readwrite');
    for (const t of transcripts) {
      await tx.store.put({
        id: `${fileId}-${t.pageNumber}`,
        fileId,
        pageNumber: t.pageNumber,
        text: t.text
      });
    }
    await tx.done;
  },

  async getRawTranscripts(fileId: string) {
    const db = await getDB();
    return db.getAllFromIndex('rawTranscripts', 'fileId', fileId);
  },

  // Subjects
  async getSubjects(): Promise<Subject[]> {
    const db = await getDB();
    return db.getAll('subjects');
  },
  async getSubject(id: string): Promise<Subject | undefined> {
    const db = await getDB();
    return db.get('subjects', id);
  },
  async addSubject(subject: Subject) {
    const db = await getDB();
    await db.put('subjects', subject);
  },
  async saveSubject(subject: Subject) {
    const db = await getDB();
    await db.put('subjects', subject);
  },
  async deleteSubject(id: string) {
    const db = await getDB();
    
    // 1. Get all posts for this subject to cleanup their chats
    const posts = await db.getAllFromIndex('posts', 'subjectId', id);
    const postIds = posts.map(p => p.id);
    
    const tx = db.transaction(['subjects', 'files', 'units', 'galleries', 'posts', 'chats', 'examSessions'], 'readwrite');
    
    // 2. Cleanup chats linked to posts of this subject
    const chatStore = tx.objectStore('chats');
    for (const postId of postIds) {
      const chatKeys = await chatStore.index('postId').getAllKeys(postId);
      for (const key of chatKeys) {
        await chatStore.delete(key);
      }
    }

    // 3. Cleanup other collections using subjectId index
    const cleanupBySubject = async (storeName: any) => {
      const store = tx.objectStore(storeName);
      const index = store.index('subjectId');
      const keys = await index.getAllKeys(id);
      for (const key of keys) {
        await store.delete(key);
      }
    };

    await cleanupBySubject('files');
    await cleanupBySubject('units');
    await cleanupBySubject('galleries');
    await cleanupBySubject('posts');
    await cleanupBySubject('examSessions');

    // 4. Finally delete the subject itself
    await tx.objectStore('subjects').delete(id);
    
    await tx.done;
  },

  // Files
  async getFiles(subjectId: string): Promise<SubjectFile[]> {
    const db = await getDB();
    return db.getAllFromIndex('files', 'subjectId', subjectId);
  },
  async addFile(file: SubjectFile) {
    const db = await getDB();
    await db.put('files', file);
  },
  async updateFile(file: SubjectFile) {
    const db = await getDB();
    await db.put('files', file);
  },
  async deleteFile(id: string) {
    const db = await getDB();
    const tx = db.transaction(['files', 'units'], 'readwrite');
    await tx.objectStore('files').delete(id);
    
    // Cleanup units
    const unitsStore = tx.objectStore('units');
    const index = unitsStore.index('fileId');
    const keys = await index.getAllKeys(id);
    for (const key of keys) {
      await unitsStore.delete(key);
    }
    await tx.done;
  },

  // Units
  async getUnits(subjectId: string): Promise<Unit[]> {
    const db = await getDB();
    return db.getAllFromIndex('units', 'subjectId', subjectId);
  },
  async addUnits(units: Unit[]) {
    const db = await getDB();
    const tx = db.transaction('units', 'readwrite');
    for (const unit of units) {
      await tx.store.put(unit);
    }
    await tx.done;
  },
  async deleteUnitsByFile(fileId: string) {
    const db = await getDB();
    const tx = db.transaction('units', 'readwrite');
    const store = tx.objectStore('units');
    const index = store.index('fileId');
    const keys = await index.getAllKeys(fileId);
    for (const key of keys) {
      await store.delete(key);
    }
    await tx.done;
  },

  // Galleries
  async getGalleries(subjectId: string): Promise<Gallery[]> {
    const db = await getDB();
    const galleries = await db.getAllFromIndex('galleries', 'subjectId', subjectId);
    return galleries.sort((a, b) => a.order - b.order);
  },
  async saveGalleries(galleries: Gallery[]) {
    const db = await getDB();
    const tx = db.transaction('galleries', 'readwrite');
    for (const gallery of galleries) {
      await tx.store.put(gallery);
    }
    await tx.done;
  },

  // Posts
  async getPostsByGallery(galleryId: string): Promise<ConceptPost[]> {
    const db = await getDB();
    const posts = await db.getAllFromIndex('posts', 'galleryId', galleryId);
    return posts.sort((a, b) => a.order - b.order);
  },
  async savePosts(posts: ConceptPost[]) {
    const db = await getDB();
    const tx = db.transaction('posts', 'readwrite');
    for (const post of posts) {
      await tx.store.put(post);
    }
    await tx.done;
  },

  async getPosts(subjectId: string): Promise<ConceptPost[]> {
    const db = await getDB();
    return db.getAllFromIndex('posts', 'subjectId', subjectId);
  },

  // ExamSessions
  async getExamSessions(subjectId: string): Promise<ExamSession[]> {
    const db = await getDB();
    return db.getAllFromIndex('examSessions', 'subjectId', subjectId);
  },

  // Chats
  async getChats(postId: string): Promise<ChatMessage[]> {
    const db = await getDB();
    return db.getAllFromIndex('chats', 'postId', postId);
  },
  async addChat(chat: ChatMessage) {
    const db = await getDB();
    await db.put('chats', chat);
  },

  async clearCurriculum(subjectId: string) {
    const db = await getDB();
    
    // 1. Get all posts for this subject to cleanup their chats
    const posts = await db.getAllFromIndex('posts', 'subjectId', subjectId);
    const postIds = posts.map(p => p.id);
    
    const tx = db.transaction(['galleries', 'posts', 'chats'], 'readwrite');
    
    // 2. Cleanup chats linked to posts of this subject
    const chatStore = tx.objectStore('chats');
    for (const postId of postIds) {
      const chatKeys = await chatStore.index('postId').getAllKeys(postId);
      for (const key of chatKeys) {
        await chatStore.delete(key);
      }
    }

    // 3. Cleanup galleries and posts
    const cleanupBySubject = async (storeName: any) => {
      const store = tx.objectStore(storeName);
      const index = store.index('subjectId');
      const keys = await index.getAllKeys(subjectId);
      for (const key of keys) {
        await store.delete(key);
      }
    };

    await cleanupBySubject('galleries');
    await cleanupBySubject('posts');

    await tx.done;
  }
};
