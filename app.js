import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, orderBy, getDocs, addDoc, writeBatch, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// =========================
// Firebase Config (REQUIRED)
// =========================
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

window.addEventListener('DOMContentLoaded', () => {

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Collections
    const colUsers = () => collection(db, 'users');
    const colLevels = () => collection(db, 'levels');
    const colSubmits = () => collection(db, 'submissions');
    const colRecords = () => collection(db, 'records');

    // Helpers
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function toast(msg, ok = true) {
        const t = document.createElement('div');
        t.className = `fixed top-4 right-4 px-4 py-2 rounded-xl shadow text-white ${ok ? 'bg-emerald-600' : 'bg-rose-600'}`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2600);
    }
    const html = (strings, ...values) => strings.map((s, i) => s + (values[i] ?? '')).join('');
    const hasRole = (u, role) => !!u && (u.role === role || u.role === 'admin' || (role === 'user' && !!u));

    let currentUser = null;

    // Sign-in handlers
    async function signIn() {
        const provider = new GoogleAuthProvider();
        try {
            const { user } = await signInWithPopup(auth, provider);
            const ref = doc(colUsers(), user.uid);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                await setDoc(ref, {
                    displayName: user.displayName || 'User',
                    role: 'user',
                    banned: false,
                    createdAt: serverTimestamp(),
                    lastLogin: serverTimestamp()
                });
            } else {
                await updateDoc(ref, { lastLogin: serverTimestamp() });
            }
            toast('Signed in');
        } catch (error) {
            console.error(error);
            toast('Sign-in failed', false);
        }
    }

    async function doSignOut() {
        await signOut(auth);
        toast('Signed out');
    }

    // Gate controls
    function showGate(show) {
        if ($('#view-gate')) $('#view-gate').classList.toggle('hidden', !show);
        ['list', 'submit-level', 'submit-record', 'rankings', 'guidelines', 'admin'].forEach(v => {
            if ($('#view-' + v)) document.getElementById('view-' + v).classList.toggle('hidden', show);
        });
    }

    onAuthStateChanged(auth, async (u) => {
        if (!u) {
            currentUser = null;
            if ($('#userArea')) $('#userArea').innerHTML = html`<button id="signin" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white">Sign in</button>`;
            if ($('#signin')) $('#signin').onclick = signIn;
            if ($('#gate-signin')) $('#gate-signin').onclick = signIn;
            showGate(true);
            return;
        }
        const usrRef = doc(colUsers(), u.uid);
        const usrSnap = await getDoc(usrRef);
        let role = 'user',
            banned = false,
            displayName = u.displayName || 'User';
        if (usrSnap.exists()) {
            const d = usrSnap.data();
            role = d.role || 'user';
            banned = !!d.banned;
            displayName = d.displayName || displayName;
        }
        currentUser = { uid: u.uid, displayName, role, banned };
        if (banned) {
            await signOut(auth);
            toast('You are banned. Contact admins.', false);
            return;
        }

        if ($('#userArea')) {
            $('#userArea').innerHTML = html`
            <div class="flex items-center gap-2">
                <span class="text-sm">${displayName} • <span class="font-semibold">${role}</span></span>
                <button id="signout" class="px-2 py-1 rounded bg-slate-200">Sign out</button>
            </div>`;
            if ($('#signout')) $('#signout').onclick = doSignOut;
        }

        if ($('#nav-admin')) $('#nav-admin').classList.toggle('hidden', !hasRole(currentUser, 'mod'));
        showGate(false);
        renderAll();
    });

    // Routing
    const routes = ['list', 'submit-level', 'submit-record', 'rankings', 'guidelines', 'admin'];

    function navTo(id) {
        for (const r of routes) {
            const view = $('#view-' + r);
            if (view) view.classList.add('hidden');
        }
        const viewToShow = $('#view-' + id);
        if (viewToShow) viewToShow.classList.remove('hidden');

        if (currentUser && hasRole(currentUser, 'mod')) {
            if ($('#nav-admin')) $('#nav-admin').classList.remove('hidden');
        } else {
            if ($('#nav-admin')) $('#nav-admin').classList.add('hidden');
        }
    }
    if ($('#nav-list')) $('#nav-list').onclick = () => navTo('list');
    if ($('#nav-submit-level')) $('#nav-submit-level').onclick = () => navTo('submit-level');
    if ($('#nav-submit-record')) $('#nav-submit-record').onclick = () => navTo('submit-record');
    if ($('#nav-rankings')) $('#nav-rankings').onclick = () => { navTo('rankings'); renderRankings(); };
    if ($('#nav-guidelines')) $('#nav-guidelines').onclick = () => navTo('guidelines');
    if ($('#nav-admin')) $('#nav-admin').onclick = () => { navTo('admin'); renderAdmin(); };

    // List rendering
    async function renderList() {
        const container = $('#levelsList');
        if (!container) return;
        container.innerHTML = '<div class="p-4 text-slate-500">Loading levels…</div>';
        const qLevels = query(colLevels(), orderBy('rank', 'asc'));
        const snap = await getDocs(qLevels);
        const items = [];
        snap.forEach(d => items.push({ id: d.id, ...d.data() }));

        container.innerHTML = items.map(l => html`
            <div class="flex items-center gap-3 p-3 bg-white rounded-xl shadow group" data-id="${l.id}">
                <div class="w-10 text-center font-bold">${l.rank}</div>
                <div class="flex-1">
                    <div class="font-semibold text-lg">${l.name} <span class="text-xs text-slate-500">(GD ID: ${l.gdId})</span></div>
                    <div class="text-sm text-slate-600 line-clamp-2">${l.description || ''}</div>
                    ${l.verificationVideo ? `<a class="text-sm text-indigo-600" href="${l.verificationVideo}" target="_blank" rel="noopener">Verification Video</a>` : ''}
                </div>
                ${hasRole(currentUser, 'mod') ? '<div class="cursor-grab handle opacity-0 group-hover:opacity-100">⠿</div>' : ''}
            </div>
        `).join('');

        if (hasRole(currentUser, 'mod')) {
            new Sortable(container, {
                handle: '.handle',
                animation: 150,
                onEnd: async () => {
                    const cards = [...container.children];
                    const batch = writeBatch(db);
                    cards.forEach((el, idx) => {
                        const id = el.getAttribute('data-id');
                        const ref = doc(db, 'levels', id);
                        batch.update(ref, { rank: idx + 1 });
                    });
                    await batch.commit();
                    toast('List order updated');
                    renderList();
                }
            });
        }

        if ($('#addLevelBtn')) $('#addLevelBtn').classList.toggle('hidden', !hasRole(currentUser, 'mod'));
    }
    if ($('#addLevelBtn')) $('#addLevelBtn').addEventListener('click', () => {
        const modal = $('#addLevelModal');
        if (modal) modal.classList.remove('hidden');
    });
    if ($('#closeAddLevel')) $('#closeAddLevel').addEventListener('click', () => {
        const modal = $('#addLevelModal');
        if (modal) modal.classList.add('hidden');
    });
    if ($('#saveLevel')) $('#saveLevel').addEventListener('click', async () => {
        const name = $('#lvl_name').value.trim();
        const gdId = $('#lvl_gdid').value.trim();
        const description = $('#lvl_desc').value.trim();
        const verificationVideo = $('#lvl_verif').value.trim();
        if (!name || !gdId) {
            toast('Name & GD ID required', false);
            return;
        }
        const qLast = query(colLevels(), orderBy('rank', 'desc'), limit(1));
        const lastSnap = await getDocs(qLast);
        let nextRank = 1;
        lastSnap.forEach(d => nextRank = (d.data().rank || 0) + 1);
        await addDoc(colLevels(), {
            name, gdId, description, verificationVideo: verificationVideo || null,
            rank: nextRank,
            createdBy: currentUser?.uid || null,
            createdAt: serverTimestamp()
        });
        toast('Level added');
        const modal = $('#addLevelModal');
        if (modal) modal.classList.add('hidden');
        if ($('#lvl_name')) $('#lvl_name').value = '';
        if ($('#lvl_gdid')) $('#lvl_gdid').value = '';
        if ($('#lvl_desc')) $('#lvl_desc').value = '';
        if ($('#lvl_verif')) $('#lvl_verif').value = '';
        renderList();
    });

    // Submissions
    if ($('#submitLevelBtn')) $('#submitLevelBtn').addEventListener('click', async () => {
        if (!currentUser) {
            toast('Sign in to submit', false);
            return;
        }
        const name = $('#sub_name').value.trim();
        const gdId = $('#sub_gdid').value.trim();
        const description = $('#sub_desc').value.trim();
        const verificationVideo = $('#sub_verif').value.trim();
        if (!name || !gdId || !verificationVideo) {
            toast('All fields required', false);
            return;
        }
        await addDoc(colSubmits(), {
            type: 'level',
            payload: { name, gdId, description, verificationVideo },
            status: 'pending',
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
        });
        toast('Level submitted for review');
        if ($('#sub_name')) $('#sub_name').value = '';
        if ($('#sub_gdid')) $('#sub_gdid').value = '';
        if ($('#sub_desc')) $('#sub_desc').value = '';
        if ($('#sub_verif')) $('#sub_verif').value = '';
    });

    if ($('#submitRecordBtn')) $('#submitRecordBtn').addEventListener('click', async () => {
        if (!currentUser) {
            toast('Sign in to submit', false);
            return;
        }
        const levelName = $('#rec_levelname').value.trim();
        const progress = parseInt($('#rec_progress').value, 10);
        const video = $('#rec_video').value.trim();
        if (!levelName || !video || isNaN(progress)) {
            toast('All fields required', false);
            return;
        }
        if (progress < 60) {
            toast('Progress must be 60% or higher', false);
            return;
        }
        await addDoc(colSubmits(), {
            type: 'record',
            payload: { levelName, progress, video },
            status: 'pending',
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
        });
        toast('Record submitted for review');
        if ($('#rec_levelname')) $('#rec_levelname').value = '';
        if ($('#rec_progress')) $('#rec_progress').value = '';
        if ($('#rec_video')) $('#rec_video').value = '';
    });

    // Admin
    async function renderAdmin() {
        if (!hasRole(currentUser, 'mod')) {
            if ($('#view-admin')) $('#view-admin').innerHTML = '<div class="p-4">No access.</div>';
            return;
        }

        // Pending submissions
        const pendingList = $('#pendingList');
        if (pendingList) {
            const qSubs = query(colSubmits(), where('status', '==', 'pending'), orderBy('createdAt', 'asc'));
            const subsSnap = await getDocs(qSubs);
            const subs = [];
            subsSnap.forEach(s => subs.push({ id: s.id, ...s.data() }));
            pendingList.innerHTML = subs.length ? subs.map(s => html`
                <div class="p-4 bg-white rounded-xl shadow">
                    <div class="text-xs text-slate-500">${s.type.toUpperCase()} • ${s.id}</div>
                    ${s.type === 'level' ? html`
                        <div class="font-semibold">Level: ${s.payload.name} (GD ID: ${s.payload.gdId})</div>
                        <div class="text-sm">${s.payload.description || ''}</div>
                        <a class="text-indigo-600 text-sm" href="${s.payload.verificationVideo}" target="_blank">Verification</a>
                    ` : html`
                        <div class="font-semibold">Record: ${s.payload.levelName}</div>
                        <div class="text-sm">Progress: ${s.payload.progress}%</div>
                        <a class="text-indigo-600 text-sm" href="${s.payload.video}" target="_blank">Video</a>
                    `}
                    <div class="mt-2 flex gap-2">
                        <button class="px-3 py-1.5 bg-emerald-600 text-white rounded" data-acc="${s.id}">Approve</button>
                        <button class="px-3 py-1.5 bg-rose-600 text-white rounded" data-rej="${s.id}">Reject</button>
                    </div>
                </div>
            `).join('') : '<div class="text-slate-500">No pending submissions</div>';

            // Wire approve/reject
            $$('#pendingList [data-acc]').forEach(btn => btn.onclick = async (e) => {
                const id = e.currentTarget.getAttribute('data-acc');
                const ref = doc(colSubmits(), id);
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const sub = snap.data();
                if (sub.type === 'level') {
                    const qLast = query(colLevels(), orderBy('rank', 'desc'), limit(1));
                    const lastSnap = await getDocs(qLast);
                    let nextRank = 1;
                    lastSnap.forEach(d => nextRank = (d.data().rank || 0) + 1);
                    await addDoc(colLevels(), {
                        name: sub.payload.name,
                        gdId: sub.payload.gdId,
                        description: sub.payload.description || '',
                        verificationVideo: sub.payload.verificationVideo,
                        rank: nextRank,
                        createdBy: sub.createdBy,
                        createdAt: serverTimestamp()
                    });
                } else if (sub.type === 'record') {
                    await addDoc(colRecords(), {
                        levelName: sub.payload.levelName,
                        userId: sub.createdBy,
                        userName: currentUser?.displayName || 'User',
                        progress: sub.payload.progress,
                        video: sub.payload.video,
                        createdAt: serverTimestamp()
                    });
                }
                await updateDoc(ref, { status: 'approved' });
                toast('Approved');
                renderAdmin();
                renderRankings();
            });

            $$('#pendingList [data-rej]').forEach(btn => btn.onclick = async (e) => {
                const id = e.currentTarget.getAttribute('data-rej');
                const ref = doc(colSubmits(), id);
                await updateDoc(ref, { status: 'rejected' });
                toast('Rejected', false);
                renderAdmin();
            });
        }

        // User admin: list + ban/unban + promote/demote
        const usersList = $('#usersList');
        if (usersList) {
            const uSnap = await getDocs(colUsers());
            const users = [];
            uSnap.forEach(u => users.push({ id: u.id, ...u.data() }));
            usersList.innerHTML = users.map(u => html`
                <div class="p-3 bg-white rounded-xl shadow flex items-center justify-between">
                    <div>
                        <div class="font-semibold">${u.displayName || 'User'} <span class="text-xs text-slate-500">(${u.id})</span></div>
                        <div class="text-sm">role: <span class="font-mono">${u.role || 'user'}</span> • banned: <span class="font-mono">${u.banned ? 'true' : 'false'}</span></div>
                    </div>
                    <div class="flex gap-2">
                        <button class="px-2 py-1 rounded bg-amber-500 text-white" data-promote="${u.id}">Toggle Mod</button>
                        <button class="px-2 py-1 rounded bg-indigo-600 text-white" data-admin="${u.id}">Toggle Admin</button>
                        <button class="px-2 py-1 rounded ${u.banned ? 'bg-emerald-600' : 'bg-rose-600'} text-white" data-ban="${u.id}">${u.banned ? 'Unban' : 'Ban'}</button>
                    </div>
                </div>
            `).join('');

            $$('#usersList [data-ban]').forEach(btn => btn.onclick = async (e) => {
                const uid = e.currentTarget.getAttribute('data-ban');
                const ref = doc(colUsers(), uid);
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const banned = !!snap.data().banned;
                await updateDoc(ref, { banned: !banned });
                toast(!banned ? 'User banned' : 'User unbanned');
                renderAdmin();
            });

            $$('#usersList [data-promote]').forEach(btn => btn.onclick = async (e) => {
                const uid = e.currentTarget.getAttribute('data-promote');
                const ref = doc(colUsers(), uid);
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const role = snap.data().role || 'user';
                const newRole = role === 'mod' ? 'user' : 'mod';
                await updateDoc(ref, { role: newRole });
                toast('Role updated');
                renderAdmin();
            });

            $$('#usersList [data-admin]').forEach(btn => btn.onclick = async (e) => {
                const uid = e.currentTarget.getAttribute('data-admin');
                const ref = doc(colUsers(), uid);
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const role = snap.data().role || 'user';
                const newRole = role === 'admin' ? 'user' : 'admin';
                await updateDoc(ref, { role: newRole });
                toast('Admin toggled');
                renderAdmin();
            });
        }
    }

    // Rankings
    async function renderRankings() {
        const recSnap = await getDocs(colRecords());
        const map = new Map();
        recSnap.forEach(r => {
            const d = r.data();
            const uid = d.userId;
            const name = d.userName || 'User';
            const pts = Math.max(0, (d.progress || 0) - 50);
            if (!map.has(uid)) map.set(uid, { name, points: 0 });
            map.get(uid).points += pts;
        });

        const lSnap = await getDocs(colLevels());
        lSnap.forEach(l => {
            const d = l.data();
            const desc = (d.description || '');
            const m = desc.match(/\[verifier:(?<uid>[^\]]+)\]/i);
            if (m && m.groups && m.groups.uid) {
                const uid = m.groups.uid.trim();
                if (!map.has(uid)) map.set(uid, { name: uid, points: 0 });
                map.get(uid).points += 200;
            }
        });

        const rows = [...map.entries()].map(([uid, v]) => ({ uid, name: v.name, points: v.points }))
            .sort((a, b) => b.points - a.points);

        const rankingsTable = $('#rankingsTable');
        if (rankingsTable) {
            rankingsTable.innerHTML = rows.length ? html`
                <div class="grid grid-cols-3 gap-2 font-semibold p-2 bg-slate-100 rounded-t-lg">
                    <div>#</div>
                    <div>Player</div>
                    <div>Points</div>
                </div>
                ${rows.map((r, i) => html`
                    <div class="grid grid-cols-3 gap-2 p-2 border-b last:border-0">
                        <div>${i + 1}</div>
                        <div>${r.name} <span class="text-xs text-slate-500">(${r.uid})</span></div>
                        <div>${r.points}</div>
                    </div>
                `).join('')}
            ` : '<div class="text-slate-500">No records yet.</div>';
        }
    }

    // Guidelines
    function renderGuidelines() {
        const guidelinesBox = $('#guidelinesBox');
        if (guidelinesBox) {
            guidelinesBox.innerHTML = html`
                <div class="prose max-w-none">
                    <h2>Submission Guidelines</h2>
                    <p>Our guidelines align with common Demon List practices. Key points:</p>
                    <ul class="list-disc ml-6">
                        <li>Record submissions must show clear, uninterrupted footage with the run start, progress, and completion (if applicable).</li>
                        <li>Records must be <strong>≥ 60%</strong> to be eligible for points.</li>
                        <li>Levels require a verification video, Geometry Dash level ID, and a concise description.</li>
                        <li>Cheating, splicing, macros, or speedhacks are grounds for rejection and bans.</li>
                        <li>Moderators may request raw footage or additional proof.</li>
                    </ul>
                    <p class="text-sm text-slate-500">For canonical rules, consult the official Demon List guidelines website.</p>
                </div>`;
        }
    }

    // Initial render
    function renderAll() {
        renderList();
        renderRankings();
        renderGuidelines();
    }

    // Boot default view
    navTo('list');
    renderGuidelines();
});
