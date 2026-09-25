import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb=initializeApp(firebaseConfig), auth=getAuth(fb);
const db=initializeFirestore(fb,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let uid=null, unsub=null, loadingRemote=false, saveTimer=null, chapter=0;
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
function changed(){state.updatedAt=Date.now(); localStorage.setItem("pulitzerReadingState",JSON.stringify(state));setDiag("#diagLocal",nowText());syncStatus(navigator.onLine?"Firebase 저장 중…":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");clearTimeout(saveTimer);saveTimer=setTimeout(saveCloud,450)}
async function saveCloud(){if(!uid||loadingRemote)return;if(!navigator.onLine){syncStatus("오프라인 · 기기에 저장됨","offline");return}try{await setDoc(doc(db,"pulitzerReadingUsers",uid),state);setDiag("#diagCloud",nowText());setDiag("#diagWrite","정상");syncError("");syncStatus("Firebase 동기화 완료")}catch(e){setDiag("#diagWrite","실패");syncError(`${e.code||"firebase-error"}\n${e.message||e}`);syncStatus("동기화 오류 · 눌러서 확인","error")}}

$$("[data-ch]").forEach(el=>el.addEventListener("input",()=>{state.chapters[chapter][el.dataset.ch]=el.value;changed()}));
$("#cumulative").addEventListener("input",e=>{state.cumulative=e.target.value;changed()});
$$("[data-r]").forEach(el=>el.addEventListener("input",()=>{state.review[el.dataset.r]=el.value;changed()}));
$("#starQuote").onclick=()=>{state.chapters[chapter].star=!state.chapters[chapter].star;$("#starQuote").textContent=state.chapters[chapter].star?"★":"☆";changed()};
$$("[data-chapter]").forEach(b=>b.onclick=()=>{chapter=+b.dataset.chapter;renderChapter()});
$$(".tabs button").forEach(b=>b.onclick=()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".view").forEach(v=>v.classList.add("hidden"));$("#"+b.dataset.view).classList.remove("hidden")});
$("#saveDaily").onclick=()=>{const text=$("#dailyDraft").value.trim();if(!text)return alert("오늘 쓴 내용을 먼저 적어주세요.");state.archive.unshift({createdAt:Date.now(),title:$("#dailyTitle").value.trim(),text});$("#dailyTitle").value="";$("#dailyDraft").value="";changed();renderArchive();alert("서평 보관함에 저장했어요.")};
$("#login").onclick=async()=>{try{$("#authMsg").textContent="로그인 중…";await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value)}catch(e){$("#authMsg").textContent="로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요."}};
$("#logout").onclick=()=>signOut(auth);
$("#backup").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`pulitzer-reading-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
$("#restore").onclick=async()=>{const f=$("#restoreFile").files[0];if(!f)return alert("백업 파일을 선택해 주세요.");try{const d=JSON.parse(await f.text());if(!d.chapters||!d.review||!d.archive)throw 0;if(!confirm("현재 데이터를 선택한 백업으로 교체할까요?"))return;state=d;changed();renderAll();await saveCloud();alert("복원했어요.")}catch(e){alert("이 앱의 올바른 백업 파일인지 확인해 주세요.")}};


$("#syncOpen").onclick=()=>{ $$(".tabs button").forEach(x=>x.classList.remove("active")); const sb=$('.tabs button[data-view="settings"]');if(sb)sb.classList.add("active");$$(".view").forEach(v=>v.classList.add("hidden"));$("#settings").classList.remove("hidden");$("#syncDiagnostic").scrollIntoView({behavior:"smooth",block:"start"})};
$("#syncTest").onclick=async()=>{if(!uid)return syncError("로그인되어 있지 않아 테스트할 수 없습니다.");if(!navigator.onLine)return syncError("인터넷 연결이 없어 Firebase 테스트를 시작할 수 없습니다.");const ref=doc(db,"pulitzerSyncDiagnostics",uid);setDiag("#diagWrite","테스트 중…");setDiag("#diagRead","대기 중…");syncError("");try{await setDoc(ref,{uid,clientTime:Date.now(),testedAt:serverTimestamp()});setDiag("#diagWrite","성공");const snap=await getDoc(ref);if(!snap.exists())throw new Error("테스트 문서를 다시 읽지 못했습니다.");setDiag("#diagRead","성공");await deleteDoc(ref);syncStatus("동기화 테스트 성공");syncError("")}catch(e){if($("#diagWrite").textContent==="테스트 중…")setDiag("#diagWrite","실패");else setDiag("#diagRead","실패");syncError(`${e.code||"firebase-error"}\\n${e.message||e}`);syncStatus("동기화 테스트 실패 · 눌러서 확인","error")}};

onAuthStateChanged(auth,user=>{if(unsub){unsub();unsub=null} if(!user){uid=null;$("#auth").classList.remove("hidden");$("#app").classList.add("hidden");return} uid=user.uid;$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");$("#userInfo").textContent=`로그인: ${user.email}`;setDiag("#diagAuth",`정상 · ${user.email}`);setDiag("#diagNet",navigator.onLine?"연결됨":"오프라인");const local=localStorage.getItem("pulitzerReadingState");if(local)try{state=JSON.parse(local)}catch{} renderAll(); loadingRemote=true;unsub=onSnapshot(doc(db,"pulitzerReadingUsers",uid),snap=>{loadingRemote=true;if(snap.exists()){const remote=snap.data();if((remote.updatedAt||0)>=(state.updatedAt||0)){state=remote;localStorage.setItem("pulitzerReadingState",JSON.stringify(state));renderAll()}}else saveCloud();loadingRemote=false;setDiag("#diagReceive",nowText());syncStatus(navigator.onLine?"Firebase 동기화 완료":"오프라인 · 기기에 저장됨",navigator.onLine?"ok":"offline");},(e)=>{loadingRemote=false;syncError(`${e.code||"firebase-error"}\n${e.message||e}`);syncStatus("동기화 오류 · 눌러서 확인","error")})});
window.addEventListener("online",()=>{setDiag("#diagNet","연결됨");syncStatus("연결됨 · Firebase 동기화 중…");saveCloud()});window.addEventListener("offline",()=>{setDiag("#diagNet","오프라인");syncStatus("오프라인 · 기기에 저장됨","offline")});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js"));