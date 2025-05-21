import { Octokit } from "@octokit/rest";
import * as dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

const token = process.env.GITHUB_TOKEN!;
const branchesEnv = process.env.PROTECTED_BRANCHES;

if (!token) {
  console.error("❌ GITHUB_TOKEN이 필요합니다.");
  process.exit(1);
}

if (!branchesEnv) {
  console.error("❌ PROTECTED_BRANCHES 환경 변수가 필요합니다.");
  process.exit(1);
}

// 쉼표로 구분된 브랜치 목록을 배열로 변환
const branches = branchesEnv.split(",").map(branch => branch.trim());

// Git remote 정보에서 owner와 repo 가져오기
function getGitRemoteInfo() {
  try {
    const remoteUrl = execSync("git config --get remote.origin.url")
      .toString()
      .trim();

    // HTTPS 형식: https://github.com/owner/repo.git
    // SSH 형식: git@github.com:owner/repo.git
    let owner = "";
    let repo = "";
    
    if (remoteUrl.includes("github.com")) {
      if (remoteUrl.startsWith("git@")) {
        // SSH 형식
        const match = remoteUrl.match(
          /git@github\.com:([^\/]+)\/([^\.]+)\.git/
        );
        if (match) {
          owner = match[1];
          repo = match[2];
        }
      } else {
        // HTTPS 형식
        const match = remoteUrl.match(
          /https:\/\/github\.com\/([^\/]+)\/([^\.]+)(?:\.git)?/
        );
        if (match) {
          owner = match[1];
          repo = match[2];
        }
      }
    }
    
    if (!owner || !repo) {
      throw new Error(
        "GitHub 원격 URL에서 소유자와 저장소 정보를 추출할 수 없습니다"
      );
    }
    
    return { owner, repo };
  } catch (error) {
    console.error("Git 원격 정보를 가져오는 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
}

const { owner, repo } = getGitRemoteInfo();

const octokit = new Octokit({ auth: token });

// 저장소의 기본 브랜치 가져오기
async function getDefaultBranch(): Promise<string> {
  try {
    const { data: repository } = await octokit.repos.get({
      owner,
      repo,
    });
    return repository.default_branch;
  } catch (error) {
    console.error("기본 브랜치 정보를 가져오는 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
}

// 저장소의 모든 브랜치 목록 가져오기
async function getAllBranches(): Promise<string[]> {
  try {
    const branches: string[] = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
        page,
      });

      const branchNames = response.data.map(branch => branch.name);
      branches.push(...branchNames);
      
      hasNextPage = response.data.length === 100;
      page++;
    }

    return branches;
  } catch (error) {
    console.error("브랜치 목록을 가져오는 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
}

// 브랜치 생성하기
async function createBranch(branchName: string, sourceBranch: string): Promise<void> {
  try {
    // 소스 브랜치의 최신 커밋 SHA 가져오기
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const sha = refData.object.sha;

    // 새 브랜치 생성
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });

    console.log(`✅ 새 브랜치 생성 완료: ${branchName} (소스: ${sourceBranch})`);
  } catch (error) {
    console.error(`❌ 브랜치 생성 중 오류 발생 (${branchName}):`, error);
    throw error;
  }
}

(async () => {
  try {
    const defaultBranch = await getDefaultBranch();
    console.log(`ℹ️ 기본 브랜치: ${defaultBranch}`);
    
    const existingBranches = await getAllBranches();
    console.log(`ℹ️ 현재 브랜치 수: ${existingBranches.length}`);
    
    // 각 브랜치에 대해 작업 수행
    for (const branch of branches) {
      console.log(`\n--------------------------------`);
      console.log(`ℹ️ 브랜치 처리 중: ${branch}`);

      // 브랜치가 이미 존재하는지 확인
      if (existingBranches.includes(branch)) {
        console.log(`ℹ️ 브랜치가 이미 존재합니다: ${branch}`);
      } else {
        // 브랜치가 없으면 생성
        console.log(`🔍 브랜치가 존재하지 않습니다. 생성 중: ${branch}`);
        try {
          await createBranch(branch, defaultBranch);
        } catch (error) {
          console.error(`⚠️ ${branch} 브랜치 생성 오류. 생성을 건너뜁니다.`);
          continue; // 현재 브랜치의 처리를 건너뛰고 다음 브랜치로 이동
        }
      }
      
      // 브랜치 보호 규칙 설정
      console.log(`🔒 브랜치 보호 규칙 설정 중: ${owner}/${repo}#${branch}`);
      
      await octokit.repos.updateBranchProtection({
        owner,
        repo,
        branch,
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
        },
        restrictions: null,
      });
      
      console.log(`✅ 브랜치 보호 규칙 설정 완료: ${owner}/${repo}#${branch}`);
    }
    
    console.log(`🎉 모든 브랜치(${branches.join(", ")})에 대한 보호 규칙이 설정되었습니다.`);
  } catch (error) {
    console.error(`❌ 브랜치 보호 규칙 설정 중 오류 발생:`, error);
    process.exit(1);
  }
})();
