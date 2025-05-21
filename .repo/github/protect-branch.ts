/**
 * 브랜치 보호 스크립트 - 하위 호환성을 위한 레거시 파일
 * 
 * 새 구조는 ./src/actions/protect-branch.ts를 사용해주세요.
 */
import { protectBranches } from "./src/actions/protect-branch";

// 직접 실행
protectBranches().catch(error => {
  console.error("❌ 오류 발생:", error);
  process.exit(1);
});
