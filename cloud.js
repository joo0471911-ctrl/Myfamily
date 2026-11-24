/*!
 * Optional Google sign-in + cloud save (Firebase Auth + Firestore).
 * Off unless firebase-config.js sets window.THALA_FIREBASE. See README.md for the 10-minute setup.
 * The app works without it: it always auto-saves in the browser (localStorage).
 */
(function () {
  'use strict';
  if (window.ThalaCloud) return; // already provided (tests, custom backends)
  var cfg = window.THALA_FIREBASE;
  var api = { enabled: !!(cfg && cfg.apiKey && cfg.projectId), user: null, _l: [] };
  window.ThalaCloud = api;
  if (!api.enabled) return;

  var V = '10.12.5';
  var BASE = 'https://www.gstatic.com/firebasejs/' + V + '/';
  function load(file) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + file;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  var ready = load('firebase-app-compat.js')
    .then(function () { return load('firebase-auth-compat.js'); })
    .then(function () { return load('firebase-firestore-compat.js'); })
    .then(function () {
      firebase.initializeApp(cfg);
      api.auth = firebase.auth();
      api.db = firebase.firestore();
      api.auth.onAuthStateChanged(function (u) {
        api.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '' } : null;
        api._l.forEach(function (f) { f(api.user); });
      });
    });

  api.onAuth = function (fn) {
    api._l.push(fn);
    if (api.user) fn(api.user);
  };
  api.signIn = function () {
    return ready.then(function () { return api.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); });
  };
  api.signOut = function () {
    return ready.then(function () { return api.auth.signOut(); });
  };
  function userDoc() { return api.db.collection('users').doc(api.user.uid); }

  // remote shape: { t: number, state: string(JSON, no photos), photos: { key: dataUrl } }
  api.pull = function () {
    return ready.then(function () {
      var ref = userDoc();
      return Promise.all([ref.get(), ref.collection('photos').get()]).then(function (r) {
        if (!r[0].exists) return null;
        var data = r[0].data();
        var photos = {};
        r[1].forEach(function (d) { photos[d.id] = d.data().data; });
        return { t: data.t || 0, state: data.state, photos: photos };
      });
    });
  };
  api.push = function (remote) {
    return ready.then(function () {
      var ref = userDoc();
      var photoCol = ref.collection('photos');
      return photoCol.get().then(function (snap) {
        var batch = api.db.batch();
        snap.forEach(function (d) { if (!(d.id in remote.photos)) batch.delete(d.ref); });
        Object.keys(remote.photos).forEach(function (k) { batch.set(photoCol.doc(k), { data: remote.photos[k] }); });
        batch.set(ref, { t: remote.t, state: remote.state });
        return batch.commit();
      });
    });
  };
})();
