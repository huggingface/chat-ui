# 환경변수 목록

이 문서는 보안 SaaS API 경유 기능에 특화된 프로젝트를 위한 환경변수 목록입니다.

## 필수 환경변수

### API 설정
```env
# LLM API 기본 URL (필수)
OPENAI_BASE_URL=https://router.huggingface.co/v1

# LLM API 키 (필수)
OPENAI_API_KEY=hf_************************
```

## 서버 전용 환경변수 (Private)

### 쿠키 및 세션 설정
```env
# 쿠키 이름 (기본값: "sessionId")
COOKIE_NAME=sessionId

# 쿠키 SameSite 설정: "lax", "strict", "none" (기본값: dev 모드에서는 "lax", 프로덕션에서는 "none")
COOKIE_SAMESITE=lax

# 쿠키 Secure 플래그: "true" 또는 "false" (기본값: dev 모드에서는 false, 프로덕션에서는 true)
COOKIE_SECURE=false

# 비보안 쿠키 허용: "true"로 설정 시 개발 환경에서 쿠키 보안 설정 완화
ALLOW_INSECURE_COOKIES=false
```

### 로깅
```env
# 로그 레벨: "debug", "info", "warn", "error" (기본값: "info")
LOG_LEVEL=info
```

### 메트릭스 및 모니터링 (선택적)
```env
# 메트릭스 서버 활성화: "true" 또는 "false"
METRICS_ENABLED=false

# 메트릭스 서버 포트 (기본값: 5565)
METRICS_PORT=5565
```

### 애플리케이션 기본 설정
```env
# 앱 기본 경로 (서브디렉토리 배포 시, 예: "/chat")
APP_BASE=

# iframe 임베딩 허용: "true"로 설정 시 CSP에서 frame-ancestors 제한 해제
ALLOW_IFRAME=false
```

## 공개 환경변수 (PUBLIC_ 접두사, 클라이언트 노출)

### 앱 정보
```env
# 앱 이름
PUBLIC_APP_NAME=ChatUI

# 앱 에셋 디렉토리 (static/$PUBLIC_APP_ASSETS에서 로고/파비콘 찾음, 기본값: "chatui", 옵션: "huggingchat")
PUBLIC_APP_ASSETS=chatui

# 앱 설명
PUBLIC_APP_DESCRIPTION="Making the community's best AI chat models available to everyone."
```

### URL 및 공유 설정
```env
# 공개 원본 URL (공유 링크 등에 사용)
PUBLIC_ORIGIN=https://yourdomain.com

# 공유 링크 접두사 (선택사항, 없으면 PUBLIC_ORIGIN + APP_BASE 사용)
PUBLIC_SHARE_PREFIX=
```

### 자동 설정 변수 (수동 설정 가능)
```env
# 버전 (package.json에서 자동 설정, svelte.config.js에서 설정 가능)
PUBLIC_VERSION=

# Git 커밋 SHA (svelte.config.js에서 자동 설정)
PUBLIC_COMMIT_SHA=
```

## 최소 설정 예시

로컬 개발을 위한 최소 설정:

```env
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_your_token_here
LOG_LEVEL=info
COOKIE_SECURE=false
PUBLIC_APP_NAME=ChatUI
PUBLIC_APP_ASSETS=chatui
```

## 환경변수 우선순위

SvelteKit은 다음 순서로 환경변수를 로드합니다:
1. `.env.local` (최우선, gitignore에 포함)
2. `.env` (기본 설정)

## 참고사항

- `PUBLIC_` 접두사가 붙은 변수는 클라이언트 코드에 노출됩니다.
- `.env.local`은 `.gitignore`에 포함되어 있어 커밋되지 않습니다.
- 프로덕션에서는 `COOKIE_SECURE=true`와 `ALLOW_IFRAME=false`를 권장합니다.
- `PUBLIC_VERSION`과 `PUBLIC_COMMIT_SHA`는 빌드 시 자동 설정됩니다.

