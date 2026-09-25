import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb=initializeApp(firebaseConfig), auth=getAuth(fb);
const db=initializeFirestore(fb,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clone=v=>JSON.parse(JSON.stringify(v));

// v13 — keep textareas compact, then grow/shrink with their content.
function autoResizeTextarea(el){
  if(!el || el.tagName!=="TEXTAREA") return;
  el.style.height="auto";
  el.style.height=`${el.scrollHeight}px`;
}
function autoResizeAllTextareas(root=document){
  root.querySelectorAll?.("textarea").forEach(autoResizeTextarea);
}
document.addEventListener("input",e=>{
  if(e.target?.matches?.("textarea")) autoResizeTextarea(e.target);
},true);
const textareaObserver=new MutationObserver(mutations=>{
  let needsResize=false;
  for(const m of mutations){
    if(m.type==="childList" && m.addedNodes.length){needsResize=true;break}
  }
  if(needsResize) requestAnimationFrame(()=>autoResizeAllTextareas());
});
textareaObserver.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener("load",()=>requestAnimationFrame(()=>autoResizeAllTextareas()));
const makeId=()=>`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const blankQuote=()=>({id:makeId(),page:"",text:"",thought:"",tags:"",star:false});
const blankChapter=()=>({range:"",keywords:"",summary:"",oneLine:"",quotes:[]});
const empty=()=>({version:2,updatedAt:0,cumulative:"",chapters:Array.from({length:14},blankChapter),review:{reason:"",intro:"",keySummary:"",impressive:"",thoughts:"",change:"",overall:"",concept:"",mainMessage:"",scene:"",outline:"",titles:"",openingEnding:""},archive:[]});

let uid=null,unsub=null,loadingRemote=false,saveTimer=null,chapter=0,quoteChapter=0;
let pendingSaveSnapshot=null,cloudWriteQueue=Promise.resolve(),dailySaveBusy=false;
let archiveView="reviews";
let state=empty();

function normalize(raw){
  const base=empty(), s=raw&&typeof raw==="object"?raw:{};
  base.updatedAt=s.updatedAt||0;base.cumulative=s.cumulative||"";
  base.review={...base.review,...(s.review||{})};
  base.archive=Array.isArray(s.archive)?s.archive:[];
  for(let i=0;i<14;i++){
    const old=(s.chapters&&s.chapters[i])||{};
    const c={...blankChapter(),...old};
    c.quotes=Array.isArray(old.quotes)?old.quotes.map(q=>({
      id:q.id||makeId(),page:q.page||"",text:q.text||"",thought:q.thought||"",tags:q.tags||"",star:!!q.star
    })):[];
    // Migrate the old single transcription into the new transcription menu once.
    if(!c.quotes.length && (old.quote||old.quotePage||old.quoteThought||old.quoteTags||old.star)){
      c.quotes.push({id:makeId(),page:old.quotePage||"",text:old.quote||"",thought:old.quoteThought||"",tags:old.quoteTags||"",star:!!old.star});
    }
    delete c.quote;delete c.quotePage;delete c.quoteThought;delete c.quoteTags;delete c.star;
    base.chapters[i]=c;
  }
  base.version=2;
  return base;
}

const reviewDefs=[["reason","책을 읽게 된 이유","왜 이 책을 골랐나요? 읽기 전 무엇을 기대했나요?"],["intro","책 소개","저자, 주제, 구성, 어떤 독자를 위한 책인지."],["keySummary","핵심 내용 요약","핵심 내용 → 저자의 설명/사례 → 내가 이해한 뜻."],["impressive","인상 깊었던 부분","별표해둔 문장 중 서평에 쓰고 싶은 것."],["thoughts","나의 생각과 경험","동의, 반박, 질문, 떠오른 경험."],["change","읽고 난 뒤의 변화","새롭게 알게 된 것과 적용할 것."],["overall","총평","좋았던 점, 아쉬웠던 점, 이 책이 내게 남긴 것."]];
$("#reviewFields").innerHTML=reviewDefs.map(([k,t,h])=>`<div class="card"><b>${t}</b><small>${h}</small><textarea data-r="${k}"></textarea></div>`).join("");
$("#chapterbar").innerHTML=Array.from({length:14},(_,i)=>`<button data-chapter="${i}">${i+1}장</button>`).join("");
$("#quoteChapterbar").innerHTML=Array.from({length:14},(_,i)=>`<button data-quote-chapter="${i}">${i+1}장</button>`).join("");

function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function nowText(){return new Date().toLocaleTimeString("ko-KR")}
function setDiag(id,text){const el=$(id);if(el)el.textContent=text}
function syncError(message=""){const el=$("#syncError");if(!el)return;el.textContent=message||"현재 감지된 동기화 오류가 없습니다.";el.classList.toggle("bad",!!message)}
function syncStatus(t,type="ok"){if($("#syncText"))$("#syncText").textContent=t;const b=$("#syncOpen");if(b){b.classList.remove("error","offline");if(type==="error")b.classList.add("error");if(type==="offline")b.classList.add("offline")}}

function renderChapter(){
  $$("#chapterbar button").forEach((b,i)=>b.classList.toggle("active",i===chapter));
  $("#chapterNo").textContent=`CHAPTER ${String(chapter+1).padStart(2,"0")}`;
  $("#chapterTitle").textContent=`${chapter+1}장의 기록`;
  const c=state.chapters[chapter];
  $$("[data-ch]").forEach(el=>el.value=c[el.dataset.ch]??"");
  $("#cumulative").value=state.cumulative||"";
}
function renderReview(){$$("[data-r]").forEach(el=>el.value=state.review[el.dataset.r]??"")}

function renderQuotes(){
  $$("#quoteChapterbar button").forEach((b,i)=>b.classList.toggle("active",i===quoteChapter));
  $("#quoteChapterNo").textContent=`CHAPTER ${String(quoteChapter+1).padStart(2,"0")} · TRANSCRIPTION`;
  $("#quoteChapterTitle").textContent=`${quoteChapter+1}장 필사`;
  const list=$("#quoteList"), quotes=state.chapters[quoteChapter].quotes||[];
  if(!quotes.length){
    list.innerHTML='<div class="card">아직 필사한 문장이 없어요. 아래의 <b>＋ 필사 문장 추가</b>를 눌러 시작해보세요.</div>';
    return;
  }
  list.innerHTML=quotes.map((q,i)=>`<article class="quoteCard" data-quote-id="${esc(q.id)}">
    <div class="quoteHead"><div><b>✒️ 필사 문장</b></div>
      <div class="quoteActions"><button class="quoteStar" data-quote-star="${esc(q.id)}" type="button" aria-label="별표">${q.star?"★":"☆"}</button><button class="deleteQuote" data-quote-delete="${esc(q.id)}" type="button">삭제</button></div></div>
    <input data-q-field="page" value="${esc(q.page)}" placeholder="p. 00">
    <textarea data-q-field="text" placeholder="필사할 문장">${esc(q.text)}</textarea>
    <b class="sub">💭 이 문장에 대한 내 생각</b>
    <textarea class="quoteThought" data-q-field="thought" placeholder="왜 이 문장이 남았나요?">${esc(q.thought)}</textarea>
    <input data-q-field="tags" value="${esc(q.tags)}" placeholder="#문장 #내글에적용">
  </article>`).join("");
}

function renderReviewArchive(){
  const box=$("#archiveList");
  if(!state.archive.length){box.innerHTML='<div class="card">아직 보관한 서평 기록이 없어요. 오늘 쓴 만큼만 남겨보세요.</div>';return}
  box.innerHTML=state.archive.map((x,i)=>`<article class="archiveItem"><small>${new Date(x.createdAt).toLocaleString("ko-KR")}</small><h3>${esc(x.title||"제목 없는 기록")}</h3><p>${esc(x.text)}</p><button data-del="${i}">삭제</button></article>`).join("");
  $$("[data-del]").forEach(b=>b.onclick=()=>{if(confirm("이 기록을 삭제할까요?")){state.archive.splice(+b.dataset.del,1);changed();renderArchive()}});
}
function allQuotes(starsOnly=false){
  const out=[];
  state.chapters.forEach((c,ci)=>(c.quotes||[]).forEach(q=>{if(!starsOnly||q.star)out.push({...q,chapter:ci+1})}));
  return out;
}
function renderQuoteArchive(starsOnly=false){
  const box=$("#quoteArchiveList"), rows=allQuotes(starsOnly);
  if(!rows.length){box.innerHTML=`<div class="card">${starsOnly?"아직 별표한 필사 문장이 없어요.":"아직 저장한 필사 문장이 없어요."}</div>`;return}
  box.innerHTML=rows.map(q=>`<article class="archiveItem">
    <div class="quoteArchiveMeta"><span>${q.chapter}장</span>${q.page?`<span>${esc(q.page)}</span>`:""}${q.star?'<span>⭐ 별표</span>':""}</div>
    <h3>${q.star?"⭐ ":""}필사 문장</h3><div class="quoteArchiveText">${esc(q.text||"")}</div>
    ${q.thought?`<div class="quoteArchiveThought"><b>내 생각</b><br>${esc(q.thought)}</div>`:""}
    ${q.tags?`<div class="quoteArchiveMeta"><span>${esc(q.tags)}</span></div>`:""}
  </article>`).join("");
}
function renderArchive(){
  $$(".archiveTabs button").forEach(b=>b.classList.toggle("active",b.dataset.archiveView===archiveView));
  const reviews=archiveView==="reviews";
  $("#archiveList").classList.toggle("hidden",!reviews);
  $("#quoteArchiveList").classList.toggle("hidden",reviews);
  if(reviews)renderReviewArchive();else renderQuoteArchive(archiveView==="stars");
}
function renderAll(){renderChapter();renderQuotes();renderReview();renderArchive()}

function changed(){
  state.updatedAt=Date.now();
  localStorage.setItem("pulitzerReadingState",JSON.stringify(state));
  setDiag("#diagLocal",nowText());
  syncStatus(navigator.onLine?"Firebase 저장 중…":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");
  pendingSaveSnapshot=clone(state);
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>flushPendingSave(),450);
}
function queueCloudSnapshot(snapshot){
  if(!snapshot)return Promise.resolve();
  if(!uid||loadingRemote)return Promise.resolve();
  if(!navigator.onLine){pendingSaveSnapshot=snapshot;syncStatus("오프라인 · 기기에 저장됨","offline");return Promise.resolve()}
  cloudWriteQueue=cloudWriteQueue.then(async()=>{
    try{await setDoc(doc(db,"pulitzerReadingUsers",uid),snapshot);setDiag("#diagCloud",nowText());setDiag("#diagWrite","정상");syncError("");syncStatus("Firebase 동기화 완료")}
    catch(e){if(!pendingSaveSnapshot||(snapshot.updatedAt||0)>=(pendingSaveSnapshot.updatedAt||0))pendingSaveSnapshot=snapshot;setDiag("#diagWrite","실패");syncError(`${e.code||"firebase-error"}\n${e.message||e}`);syncStatus("동기화 오류 · 눌러서 확인","error")}
  });return cloudWriteQueue;
}
function flushPendingSave(){clearTimeout(saveTimer);saveTimer=null;const snapshot=pendingSaveSnapshot;pendingSaveSnapshot=null;return queueCloudSnapshot(snapshot)}
async function saveCloud(snapshot=null){return queueCloudSnapshot(snapshot?clone(snapshot):clone(state))}

$$("[data-ch]").forEach(el=>el.addEventListener("input",()=>{const target=chapter;state.chapters[target][el.dataset.ch]=el.value;changed()}));
$("#cumulative").addEventListener("input",e=>{state.cumulative=e.target.value;changed()});
$$("[data-r]").forEach(el=>el.addEventListener("input",()=>{state.review[el.dataset.r]=el.value;changed()}));

$$("[data-chapter]").forEach(b=>b.onclick=()=>{flushPendingSave();chapter=+b.dataset.chapter;renderChapter()});
$$("[data-quote-chapter]").forEach(b=>b.onclick=()=>{flushPendingSave();quoteChapter=+b.dataset.quoteChapter;renderQuotes()});

$("#addQuote").onclick=()=>{const target=quoteChapter;state.chapters[target].quotes.push(blankQuote());changed();renderQuotes();setTimeout(()=>$("#quoteList .quoteCard:last-child textarea[data-q-field='text']")?.focus(),0)};
$("#quoteList").addEventListener("input",e=>{
  const field=e.target.closest("[data-q-field]");if(!field)return;
  const card=field.closest("[data-quote-id]");if(!card)return;
  const targetChapter=quoteChapter, id=card.dataset.quoteId;
  const q=state.chapters[targetChapter].quotes.find(x=>x.id===id);if(!q)return;
  q[field.dataset.qField]=field.value;changed();
});
$("#quoteList").addEventListener("click",e=>{
  const star=e.target.closest("[data-quote-star]"), del=e.target.closest("[data-quote-delete]");
  if(star){
    const targetChapter=quoteChapter,id=star.dataset.quoteStar,q=state.chapters[targetChapter].quotes.find(x=>x.id===id);
    if(q){q.star=!q.star;changed();renderQuotes();if(archiveView!=="reviews")renderArchive()}
  }
  if(del){
    const targetChapter=quoteChapter,id=del.dataset.quoteDelete;
    if(confirm("이 필사 기록을 삭제할까요?")){
      state.chapters[targetChapter].quotes=state.chapters[targetChapter].quotes.filter(x=>x.id!==id);
      changed();renderQuotes();if(archiveView!=="reviews")renderArchive();
    }
  }
});
$$("[data-archive-view]").forEach(b=>b.onclick=()=>{archiveView=b.dataset.archiveView;renderArchive()});

function showView(viewId,remember=true){
  const target=document.getElementById(viewId);if(!target)return;
  $$(".tabs button").forEach(x=>x.classList.toggle("active",x.dataset.view===viewId));
  $$(".view").forEach(v=>v.classList.add("hidden"));target.classList.remove("hidden");
  if(remember)localStorage.setItem("pulitzerLastView",viewId);
  if(viewId==="quotes")renderQuotes();if(viewId==="archive")renderArchive();
}
$$(".tabs button").forEach(b=>b.onclick=()=>{flushPendingSave();showView(b.dataset.view,true)});

$("#saveDaily").onclick=async()=>{
  if(dailySaveBusy)return;
  const title=$("#dailyTitle").value.trim(),text=$("#dailyDraft").value.trim();
  if(!text)return alert("오늘 쓴 내용을 먼저 적어주세요.");
  dailySaveBusy=true;const btn=$("#saveDaily");if(btn){btn.disabled=true;btn.textContent="보관 중…"}
  const snapshot={createdAt:Date.now(),title,text};
  state.archive.unshift(snapshot);$("#dailyTitle").value="";$("#dailyDraft").value="";changed();renderArchive();
  try{await flushPendingSave();alert("보관함에 저장했어요.")}
  finally{dailySaveBusy=false;if(btn){btn.disabled=false;btn.textContent="오늘 기록 보관하기"}}
};

$("#login").onclick=async()=>{try{$("#authMsg").textContent="로그인 중…";await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value)}catch(e){$("#authMsg").textContent="로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요."}};
$("#logout").onclick=()=>signOut(auth);
$("#backup").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`pulitzer-reading-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
$("#restore").onclick=async()=>{const f=$("#restoreFile").files[0];if(!f)return alert("백업 파일을 선택해 주세요.");try{const d=JSON.parse(await f.text());if(!d.chapters||!d.review||!d.archive)throw 0;if(!confirm("현재 데이터를 선택한 백업으로 교체할까요?"))return;state=normalize(d);changed();renderAll();await flushPendingSave();alert("복원했어요.")}catch(e){alert("이 앱의 올바른 백업 파일인지 확인해 주세요.")}};

function openSyncDiagnostic(){showView("settings",true);setTimeout(()=>$("#syncDiagnostic")?.scrollIntoView({behavior:"smooth",block:"start"}),50)}
async function runSyncTest(){
  const btn=$("#syncTest");if(btn){btn.disabled=true;btn.textContent="테스트 중…"}
  setDiag("#diagAuth",auth.currentUser?`정상 · ${auth.currentUser.email}`:"로그인 안 됨");setDiag("#diagNet",navigator.onLine?"연결됨":"오프라인");setDiag("#diagWrite","준비 중…");setDiag("#diagRead","대기 중");syncError("");syncStatus("Firebase 진단 중…");
  try{
    if(!auth.currentUser)throw new Error("Firebase Authentication 로그인 상태가 아닙니다.");if(!navigator.onLine)throw new Error("인터넷 연결이 없습니다.");
    const ref=doc(db,"pulitzerSyncDiagnostics",auth.currentUser.uid);setDiag("#diagWrite","쓰기 요청 중…");await setDoc(ref,{uid:auth.currentUser.uid,clientTime:Date.now(),testedAt:serverTimestamp()});setDiag("#diagWrite","성공 · "+nowText());setDiag("#diagRead","읽기 요청 중…");
    const snap=await getDoc(ref);if(!snap.exists())throw new Error("쓰기에는 성공했지만 테스트 문서를 다시 읽지 못했습니다.");setDiag("#diagRead","성공 · "+nowText());try{await deleteDoc(ref)}catch(_){}syncStatus("Firebase 읽기·쓰기 정상");syncError("");
  }catch(e){if($("#diagWrite")?.textContent.includes("요청"))setDiag("#diagWrite","실패");if($("#diagRead")?.textContent.includes("요청"))setDiag("#diagRead","실패");syncError(`오류 코드: ${e?.code||"firebase-error"}\n${e?.message||String(e)}`);syncStatus("동기화 오류 · 눌러서 확인","error")}
  finally{if(btn){btn.disabled=false;btn.textContent="동기화 테스트"}}
}
document.addEventListener("click",e=>{if(e.target.closest("#syncOpen")){e.preventDefault();openSyncDiagnostic()}if(e.target.closest("#syncTest")){e.preventDefault();runSyncTest()}});

onAuthStateChanged(auth,user=>{
  if(unsub){unsub();unsub=null}
  if(!user){uid=null;$("#auth").classList.remove("hidden");$("#app").classList.add("hidden");return}
  uid=user.uid;$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");$("#userInfo").textContent=`로그인: ${user.email}`;setDiag("#diagAuth",`정상 · ${user.email}`);setDiag("#diagNet",navigator.onLine?"연결됨":"오프라인");syncStatus("Firebase 연결 확인 중…");
  const local=localStorage.getItem("pulitzerReadingState");if(local)try{state=normalize(JSON.parse(local))}catch{}renderAll();
  loadingRemote=true;
  unsub=onSnapshot(doc(db,"pulitzerReadingUsers",uid),snap=>{
    loadingRemote=true;
    if(snap.exists()){const remote=normalize(snap.data());if((remote.updatedAt||0)>=(state.updatedAt||0)){state=remote;localStorage.setItem("pulitzerReadingState",JSON.stringify(state));renderAll()}}
    else saveCloud();
    loadingRemote=false;setDiag("#diagReceive",nowText());syncStatus(navigator.onLine?"Firebase 동기화 완료":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");
  },e=>{loadingRemote=false;syncError(`${e.code||"firebase-error"}\n${e.message||e}`);syncStatus("동기화 오류 · 눌러서 확인","error")});
});
window.addEventListener("online",()=>{setDiag("#diagNet","연결됨");syncStatus("연결됨 · Firebase 동기화 중…");if(pendingSaveSnapshot)flushPendingSave();else saveCloud()});
window.addEventListener("offline",()=>{setDiag("#diagNet","오프라인");syncStatus("오프라인 · 기기에 저장됨","offline")});

const remembered=localStorage.getItem("pulitzerLastView");
if(remembered&&document.getElementById(remembered))setTimeout(()=>showView(remembered,false),0);
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js",{scope:"./"}).then(r=>r.update()).catch(console.error));
