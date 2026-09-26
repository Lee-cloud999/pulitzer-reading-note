pulitzer-reading-note 아이콘 경로 수정본 v14

GitHub 저장소 루트에 아래 3개 파일을 덮어쓰세요.
- index.html
- manifest.webmanifest
- sw.js

수정 내용
- 존재하지 않는 ./icons/icon-192.png 경로를 ./icon-192.png 로 수정
- 존재하지 않는 ./icons/icon-512.png 경로를 ./icon-512.png 로 수정
- apple-touch-icon 경로 수정
- manifest 및 아이콘 URL 캐시 버전 v14 적용
- service worker 앱 셸에 icon-192.png / icon-512.png 추가
- 캐시 이름을 pulitzer-reading-v14-icon-path-fix 로 갱신

기존 app.js, style.css, Firebase 설정, 기록 저장 로직은 수정하지 않았습니다.
기존 icon-192.png / icon-512.png 파일은 저장소 루트에 이미 있으므로 ZIP에 중복 포함하지 않았습니다.
