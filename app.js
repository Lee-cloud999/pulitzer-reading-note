import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb=initializeApp(firebaseConfig), auth=getAuth(fb);
const db=initializeFirestore(fb,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let uid=null, unsub=null, loadingRemote=false, saveTimer=null, chapter=0;
let pendingSaveSnapshot=null;
let cloudWriteQueue=Promise.resolve();
let dailySaveBusy=false;
const cloneState=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({version:1,updatedAt:0,cumulative:"",chapters:Array.from({length:14},()=>({range:"",keywords:"",quotePage:"",quote:"",quoteThought:"",quoteTags:"",summary:"",oneLine:"",star:false})),review:{reason:"",intro:"",keySummary:"",impressive:"",thoughts:"",change:"",overall:"",concept:"",mainMessage:"",scene:"",outline:"",titles:"",openingEnding:""},archive:[]});
let state=empty();

const reviewDefs=[["reason","책을 읽게 된 이유","왜 이 책을 골랐나요? 읽기 전 무엇을 기대했나요?"],["intro","책 소개","저자, 주제, 구성, 어떤 독자를 위한 책인지."],["keySummary","핵심 내용 요약","핵심 내용 → 저자의 설명/사례 → 내가 이해한 뜻."],["impressive","인상 깊었던 부분","별표해둔 문장 중 서평에 쓰고 싶은 것."],["thoughts","나의 생각과 경험","동의, 반박, 질문, 떠오른 경험."],["change","읽고 난 뒤의 변화","새롭게 알게 된 것과 적용할 것."],["overall","총평","좋았던 점, 아쉬웠던 점, 이 책이 내게 남긴 것."]];
$("#reviewFields").innerHTML=reviewDefs.map(([k,t,h])=>`<div class="card"><b>${t}</b><small>${h}</small><textarea data-r="${k}"></textarea></div>`).join("");
$("#chapterbar").innerHTML=Array.from({length:14},(_,i)=>`<button data-chapter="${i}">${i+1}장</button>`).join("");

function nowText(){return new Date().toLocaleTimeString("ko-KR")}
function setDiag(id,text){const el=$(id);if(el)el.textContent=text}
function syncError(message=""){const el=$("#syncError");if(!el)return;el.textContent=message||"현재 감지된 동기화 오류가 없습니다.";el.classList.toggle("bad",!!message)}
function syncStatus(t,type="ok"){ $("#syncText").textContent=t; const b=$("#syncOpen"); if(b){b.classList.remove("error","offline");if(type==="error")b.classList.add("error");if(type==="offline")b.classList.add("offline")} }
function renderChapter(){ $$("#chapterbar button").forEach((b,i)=>b.classList.toggle("active",i===chapter)); $("#chapterNo").textContent=`CHAPTER ${String(chapter+1).padStart(2,"0")}`;$("#chapterTitle").textContent=`${chapter+1}장의 기록`; const c=state.chapters[chapter]; $$("[data-ch]").forEach(el=>el.value=c[el.dataset.ch]??""); $("#starQuote").textContent=c.star?"★":"☆"; $("#cumulative").value=state.cumulative||""}
function renderReview(){ $$("[data-r]").forEach(el=>el.value=state.review[el.dataset.r]??"") }
function renderArchive(){ const box=$("#archiveList"); if(!state.archive.length){box.innerHTML='<div class="card">아직 보관한 서평 기록이 없어요. 오늘 쓴 만큼만 남겨보세요.</div>';return} box.innerHTML=state.archive.map((x,i)=>`<article class="archiveItem"><small>${new Date(x.createdAt).toLocaleString("ko-KR")}</small><h3>${esc(x.title||"제목 없는 기록")}</h3><p>${esc(x.text)}</p><button data-del="${i}">삭제</button></article>`).join(""); $$("[data-del]").forEach(b=>b.onclick=()=>{if(confirm("이 기록을 삭제할까요?")){state.archive.splice(+b.dataset.del,1);changed();renderArchive()}})}
function esc(v=""){return v.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function renderAll(){renderChapter();renderReview();renderArchive()}
function changed(){
  state.updatedAt=Date.now();
  localStorage.setItem("pulitzerReadingState",JSON.stringify(state));
  setDiag("#diagLocal",nowText());
  syncStatus(navigator.onLine?"Firebase 저장 중…":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");

  // IMPORTANT: capture the exact data that belongs to this edit.
  // Later navigation must never redirect this delayed save to another chapter/item.
  pendingSaveSnapshot=cloneState(state);
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>flushPendingSave(),450);
}

function queueCloudSnapshot(snapshot){
  if(!snapshot)return Promise.resolve();
  if(!uid||loadingRemote)return Promise.resolve();
  if(!navigator.onLine){
    pendingSaveSnapshot=snapshot;
    syncStatus("오프라인 · 기기에 저장됨","offline");
    return Promise.resolve();
  }

  // Serialize writes so an older request cannot finish after a newer one and overwrite it.
  cloudWriteQueue=cloudWriteQueue.then(async()=>{
    try{
      await setDoc(doc(db,"pulitzerReadingUsers",uid),snapshot);
      setDiag("#diagCloud",nowText());
      setDiag("#diagWrite","정상");
      syncError("");
      syncStatus("Firebase 동기화 완료");
    }catch(e){
      // Keep the newest failed snapshot available for the next retry.
      if(!pendingSaveSnapshot || (snapshot.updatedAt||0) >= (pendingSaveSnapshot.updatedAt||0)){
        pendingSaveSnapshot=snapshot;
      }
      setDiag("#diagWrite","실패");
      syncError(`${e.code||"firebase-error"}\n${e.message||e}`);
      syncStatus("동기화 오류 · 눌러서 확인","error");
    }
  });
  return cloudWriteQueue;
}

function flushPendingSave(){
  clearTimeout(saveTimer);
  saveTimer=null;
  const snapshot=pendingSaveSnapshot;
  pendingSaveSnapshot=null;
  return queueCloudSnapshot(snapshot);
}

async function saveCloud(snapshot=null){
  const fixedSnapshot=snapshot ? cloneState(snapshot) : cloneState(state);
  return queueCloudSnapshot(fixedSnapshot);
}

$$("[data-ch]").forEach(el=>el.addEventListener("input",()=>{
  const targetChapter=chapter;
  state.chapters[targetChapter][el.dataset.ch]=el.value;
  changed();
}));
$("#cumulative").addEventListener("input",e=>{state.cumulative=e.target.value;changed()});
$$("[data-r]").forEach(el=>el.addEventListener("input",()=>{state.review[el.dataset.r]=el.value;changed()}));
$("#starQuote").onclick=()=>{state.chapters[chapter].star=!state.chapters[chapter].star;$("#starQuote").textContent=state.chapters[chapter].star?"★":"☆";changed()};
$$("[data-chapter]").forEach(b=>b.onclick=()=>{
  flushPendingSave();
  chapter=+b.dataset.chapter;
  renderChapter();
});
$$(".tabs button").forEach(b=>b.onclick=()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".view").forEach(v=>v.classList.add("hidden"));$("#"+b.dataset.view).classList.remove("hidden")});
$("#saveDaily").onclick=async()=>{
  if(dailySaveBusy)return;
  const title=$("#dailyTitle").value.trim();
  const text=$("#dailyDraft").value.trim();
  if(!text)return alert("오늘 쓴 내용을 먼저 적어주세요.");

  dailySaveBusy=true;
  const btn=$("#saveDaily");
  if(btn){btn.disabled=true;btn.textContent="보관 중…"}

  // Freeze exactly what the user clicked to archive.
  const archiveSnapshot={createdAt:Date.now(),title,text};
  state.archive.unshift(archiveSnapshot);
  $("#dailyTitle").value="";
  $("#dailyDraft").value="";
  changed();
  renderArchive();

  try{
    await flushPendingSave();
    alert("서평 보관함에 저장했어요.");
  }finally{
    dailySaveBusy=false;
    if(btn){btn.disabled=false;btn.textContent="오늘 기록 보관하기"}
  }
};
$("#login").onclick=async()=>{try{$("#authMsg").textContent="로그인 중…";await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value)}catch(e){$("#authMsg").textContent="로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요."}};
$("#logout").onclick=()=>signOut(auth);
$("#backup").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`pulitzer-reading-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
$("#restore").onclick=async()=>{const f=$("#restoreFile").files[0];if(!f)return alert("백업 파일을 선택해 주세요.");try{const d=JSON.parse(await f.text());if(!d.chapters||!d.review||!d.archive)throw 0;if(!confirm("현재 데이터를 선택한 백업으로 교체할까요?"))return;state=d;changed();renderAll();await flushPendingSave();alert("복원했어요.")}catch(e){alert("이 앱의 올바른 백업 파일인지 확인해 주세요.")}};



function openSyncDiagnostic(){
  $$(".tabs button").forEach(x=>x.classList.remove("active"));
  const sb=$('.tabs button[data-view="settings"]'); if(sb)sb.classList.add("active");
  $$(".view").forEach(v=>v.classList.add("hidden")); $("#settings").classList.remove("hidden");
  localStorage.setItem("pulitzerLastView","settings");
  setTimeout(()=>$("#syncDiagnostic")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
}
async function runSyncTest(){
  const btn=$("#syncTest");
  if(btn){btn.disabled=true;btn.textContent="테스트 중…"}
  setDiag("#diagAuth",auth.currentUser?`정상 · ${auth.currentUser.email}`:"로그인 안 됨");
  setDiag("#diagNet",navigator.onLine?"연결됨":"오프라인");
  setDiag("#diagWrite","준비 중…"); setDiag("#diagRead","대기 중");
  syncError(""); syncStatus("Firebase 진단 중…");
  try{
    if(!auth.currentUser) throw new Error("Firebase Authentication 로그인 상태가 아닙니다.");
    if(!navigator.onLine) throw new Error("인터넷 연결이 없습니다.");
    const ref=doc(db,"pulitzerSyncDiagnostics",auth.currentUser.uid);
    setDiag("#diagWrite","쓰기 요청 중…");
    await setDoc(ref,{uid:auth.currentUser.uid,clientTime:Date.now(),testedAt:serverTimestamp()});
    setDiag("#diagWrite","성공 · "+nowText());
    setDiag("#diagRead","읽기 요청 중…");
    const snap=await getDoc(ref);
    if(!snap.exists()) throw new Error("쓰기에는 성공했지만 테스트 문서를 다시 읽지 못했습니다.");
    setDiag("#diagRead","성공 · "+nowText());
    try{await deleteDoc(ref)}catch(_){}
    syncStatus("Firebase 읽기·쓰기 정상");
    syncError("");
  }catch(e){
    if($("#diagWrite")?.textContent.includes("요청")) setDiag("#diagWrite","실패");
    if($("#diagRead")?.textContent.includes("요청")) setDiag("#diagRead","실패");
    const code=e?.code||"firebase-error", message=e?.message||String(e);
    syncError(`오류 코드: ${code}\n${message}`);
    syncStatus("동기화 오류 · 눌러서 확인","error");
  }finally{
    if(btn){btn.disabled=false;btn.textContent="동기화 테스트"}
  }
}
document.addEventListener("click",e=>{
  const syncButton=e.target.closest("#syncOpen");
  const testButton=e.target.closest("#syncTest");
  if(syncButton){e.preventDefault();openSyncDiagnostic()}
  if(testButton){e.preventDefault();runSyncTest()}
});

onAuthStateChanged(auth,user=>{if(unsub){unsub();unsub=null} if(!user){uid=null;$("#auth").classList.remove("hidden");$("#app").classList.add("hidden");return} uid=user.uid;$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");$("#userInfo").textContent=`로그인: ${user.email}`;setDiag("#diagAuth",`정상 · ${user.email}`);setDiag("#diagNet",navigator.onLine?"연결됨":"오프라인");syncStatus("Firebase 연결 확인 중…");const local=localStorage.getItem("pulitzerReadingState");if(local)try{state=JSON.parse(local)}catch{} renderAll(); loadingRemote=true;unsub=onSnapshot(doc(db,"pulitzerReadingUsers",uid),snap=>{loadingRemote=true;if(snap.exists()){const remote=snap.data();if((remote.updatedAt||0)>=(state.updatedAt||0)){state=remote;localStorage.setItem("pulitzerReadingState",JSON.stringify(state));renderAll()}}else saveCloud();loadingRemote=false;setDiag("#diagReceive",nowText());syncStatus(navigator.onLine?"Firebase 동기화 완료":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");},(e)=>{loadingRemote=false;syncError(`${e.code||"firebase-error"}\n${e.message||e}`);syncStatus("동기화 오류 · 눌러서 확인","error")})});
window.addEventListener("online",()=>{setDiag("#diagNet","연결됨");syncStatus("연결됨 · Firebase 동기화 중…");if(pendingSaveSnapshot)flushPendingSave();else saveCloud()});window.addEventListener("offline",()=>{setDiag("#diagNet","오프라인");syncStatus("오프라인 · 기기에 저장됨","offline")});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js"));
function rememberableShowView(viewId,remember=true){
  const target=document.getElementById(viewId); if(!target)return;
  document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",x.dataset.view===viewId));
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  target.classList.remove("hidden");
  if(remember)localStorage.setItem("pulitzerLastView",viewId);
}
document.addEventListener("click",e=>{
  const b=e.target.closest(".tabs button[data-view]");
  if(b){e.preventDefault();rememberableShowView(b.dataset.view,true)}
});
const _rememberedView=localStorage.getItem("pulitzerLastView");
if(_rememberedView && document.getElementById(_rememberedView)){
  setTimeout(()=>rememberableShowView(_rememberedView,false),0);
}
