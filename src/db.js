import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, getDoc, getDocs, collection, query, where, addDoc, updateDoc, onSnapshot, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { useState, useEffect } from "react";

const firebaseConfig = {
  apiKey: "AIzaSyAPrfR-hG-5CeZiD0EIz_P1r93ywZbxcjc",
  authDomain: "chompchem.firebaseapp.com",
  projectId: "chompchem",
  storageBucket: "chompchem.firebasestorage.app",
  messagingSenderId: "379599502348",
  appId: "1:379599502348:web:d1be32d868ac2a813f0229",
  measurementId: "G-NWEXYL1PQ0"
};

import { getAuth } from "firebase/auth";

const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);

// Enable Firestore Offline Persistence
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(firestore).catch((err) => {
    console.warn("Firestore offline persistence failed to enable:", err.code, err.message);
  });
}

export const storage = getStorage(app);

let authInstance = null;
export const getFirebaseAuth = () => {
  if (!authInstance) {
    authInstance = getAuth(app);
  }
  return authInstance;
};

const compressImageToBase64 = (file, maxWidth = 1000) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => reject(new Error('Failed to load image for compression'));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
  });
};

export const uploadFile = async (file, path, onProgress) => {
  if (!file) throw new Error('No file provided');
  
  if (file.type.startsWith('image/')) {
    if (onProgress) onProgress(50);
    try {
      const base64Url = await compressImageToBase64(file);
      if (onProgress) onProgress(100);
      return base64Url;
    } catch (e) {
      console.error('Base64 compression failed', e);
    }
  }
  throw new Error('Only image files are supported in this setup');
};

export function getCollectionName(baseName) {
  // Always hardcoded for Field Training workspace
  return `fieldtraining_${baseName}`;
}

// React Hook for Real-time listeners
export function useLiveCollection(collectionName) {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    const actualCollection = getCollectionName(collectionName);
    const q = query(collection(firestore, actualCollection));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setData(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [collectionName]);
  
  return data;
}

// Collection Helpers (DAO pattern)
export const db = {
  scientists: {
    add: async (scientist) => {
      const ref = await addDoc(collection(firestore, getCollectionName('scientists')), scientist);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('scientists'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('scientists'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('scientists'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    },
    where: (field) => {
      return {
        equals: (value) => {
          return {
            first: async () => {
              const q = query(collection(firestore, getCollectionName('scientists')), where(field, '==', value));
              const snap = await getDocs(q);
              return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
            }
          };
        }
      };
    }
  },

  ft_places: {
    add: async (place) => {
      const ref = await addDoc(collection(firestore, getCollectionName('ft_places')), place);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('ft_places'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('ft_places'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_places'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    }
  },

  ft_registrations: {
    add: async (reg) => {
      const ref = await addDoc(collection(firestore, getCollectionName('ft_registrations')), reg);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('ft_registrations'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('ft_registrations'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_registrations'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    }
  },

  ft_settings: {
    get: async () => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_settings'), 'global'));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    },
    set: async (data) => {
      await setDoc(doc(firestore, getCollectionName('ft_settings'), 'global'), data, { merge: true });
    }
  },

  ft_evaluations: {
    add: async (evalData) => {
      const ref = await addDoc(collection(firestore, getCollectionName('ft_evaluations')), evalData);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('ft_evaluations'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('ft_evaluations'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_evaluations'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    }
  },

  ft_reset_requests: {
    add: async (req) => {
      const ref = await addDoc(collection(firestore, getCollectionName('ft_reset_requests')), req);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('ft_reset_requests'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('ft_reset_requests'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_reset_requests'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    }
  },

  ft_notifications: {
    add: async (notif) => {
      const ref = await addDoc(collection(firestore, getCollectionName('ft_notifications')), notif);
      return ref.id;
    },
    update: async (id, data) => {
      await updateDoc(doc(firestore, getCollectionName('ft_notifications'), String(id)), data);
    },
    delete: async (id) => {
      await deleteDoc(doc(firestore, getCollectionName('ft_notifications'), String(id)));
    },
    get: async (id) => {
      const d = await getDoc(doc(firestore, getCollectionName('ft_notifications'), String(id)));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    }
  }
};
