# Firestore Connection Debugging Guide

## Issue: "Network timeout: Saving took too long"

### Most Likely Causes:

1. **Firestore Security Rules** - Rules may be blocking writes
2. **Network/Firewall** - Corporate network or firewall blocking Firestore
3. **Firebase Billing** - Project may be over quota or billing disabled

---

## Step 1: Check Firestore Security Rules

1. Go to: https://console.firebase.google.com/project/attention-detection/firestore/rules
2. Check your current rules. They might look like:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if false;  // <-- This blocks everything!
       }
     }
   }
   ```

3. **Temporarily** change to allow authenticated writes:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /analysisResults/{document} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

4. Click "Publish" and try saving again

---

## Step 2: Check Browser Console

1. Open DevTools (F12 or Cmd+Option+I)
2. Go to Console tab
3. Look for errors mentioning:
   - "permission-denied"
   - "FIRESTORE"
   - "Failed to get document"
   
**Screenshot or copy any errors you see**

---

## Step 3: Test Direct Connection

Open your browser console on localhost:3001 and run:

```javascript
// Test 1: Check if Firebase is initialized
console.log('Firebase initialized:', window.firebase || 'No window.firebase');

// Test 2: Try a simple write
const { db } = await import('./firebase/config.js');
console.log('Firestore instance:', db);

// Test 3: Attempt write
const { collection, addDoc } = await import('firebase/firestore');
try {
  const docRef = await addDoc(collection(db, 'test'), {
    test: 'Hello',
    timestamp: new Date()
  });
  console.log('✅ SUCCESS! Document written with ID:', docRef.id);
} catch (error) {
  console.error('❌ FAILED:', error.code, error.message);
}
```

**Send me the output from this test**

---

## Step 4: Check Firebase Console - Firestore Database

1. Go to: https://console.firebase.google.com/project/attention-detection/firestore/databases/-default-/data
2. Verify the database exists and is active (not in "Datastore mode")
3. Check if you can see collections

---

## Step 5: Verify Billing & Quotas

1. Go to: https://console.firebase.google.com/project/attention-detection/usage
2. Check if you're over quota
3. Ensure Blaze plan is active (or Spark plan hasn't exceeded limits)

---

## Next Steps:

Please check these items in order and let me know:
1. What do your Firestore security rules look like?
2. What errors appear in the browser console?
3. What happens when you run the test connection code?
