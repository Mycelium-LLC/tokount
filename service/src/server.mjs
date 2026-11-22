import { Firestore } from '@google-cloud/firestore';
import { createApp } from './app.mjs';

const firestore = new Firestore();
const collection = firestore.collection(process.env.TOKOUNT_COLLECTION || 'tokount_profiles');
const store = {
  async get(handle) { const snap = await collection.doc(handle).get(); return snap.exists ? snap.data() : null; },
  async set(handle, value) { await collection.doc(handle).set(value); }
};
const app = await createApp({ store });
app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('tokount listening'));
