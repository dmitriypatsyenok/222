import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, getDocFromServer, getDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export function subscribeToDoc<T>(
  docId: string,
  onUpdate: (data: T) => void,
  onMissing?: () => void
) {
  const docRef = doc(db, 'app_data', docId);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.data();
        if (val && val.content !== undefined) {
          onUpdate(val.content as T);
        }
      } else if (onMissing) {
        onMissing();
      }
    },
    (err) => {
      console.warn(`Firebase sync notice for ${docId}:`, err);
    }
  );
}

export async function fetchDocDataFromServer<T>(docId: string): Promise<T | null> {
  try {
    const docRef = doc(db, 'app_data', docId);
    let snap;
    try {
      snap = await getDocFromServer(docRef);
    } catch {
      snap = await getDoc(docRef);
    }
    if (snap && snap.exists()) {
      const data = snap.data();
      if (data && data.content !== undefined) {
        return data.content as T;
      }
    }
    return null;
  } catch (err) {
    console.warn(`Error fetching ${docId} from server:`, err);
    return null;
  }
}

export async function updateDocData<T>(docId: string, content: T) {
  try {
    const docRef = doc(db, 'app_data', docId);
    await setDoc(docRef, {
      content,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error(`Error updating ${docId} in Firebase:`, err);
  }
}

