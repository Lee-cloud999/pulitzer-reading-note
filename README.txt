퓰리처 글쓰기 수업 Reading Note PWA

GitHub Pages 배포:
1. 이 폴더 안의 파일/폴더를 GitHub 저장소 루트에 그대로 업로드합니다.
2. Settings > Pages > Deploy from a branch > main / root 로 배포합니다.
3. Firebase Authentication > Settings > Authorized domains에 GitHub Pages 도메인을 추가합니다.
4. Firestore 규칙에서 pulitzerReadingUsers 문서는 로그인한 본인 uid만 읽고 쓰도록 허용해야 합니다.

권장 Firestore rules 예시:
match /pulitzerReadingUsers/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}

백업: 앱의 '백업' 메뉴에서 JSON 다운로드 / 복원.
