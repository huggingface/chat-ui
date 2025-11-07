# Chat UI (한국어)

![Chat UI 저장소 썸네일](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/chat-ui-2026.png)

로컬 또는 클라우드에서 호스팅되는 LLM(OpenAI 호환 API)을 연결해 사용하는 채팅 UI 프로젝트입니다. 이 애플리케이션은 SvelteKit 기반이며, [HuggingChat (hf.co/chat)](https://huggingface.co/chat)을 구동합니다.

> 참고
>
> - Chat UI는 OpenAI 호환 API만 지원합니다. `OPENAI_BASE_URL`과 `/models` 엔드포인트를 통해 동작합니다.
> - 레거시 분기는 [legacy 브랜치](https://github.com/huggingface/chat-ui/tree/legacy)에서 확인할 수 있습니다.

목차
0. [빠른 시작](#빠른-시작-quickstart)

1. [데이터베이스 옵션](#데이터베이스-옵션-database-options)
2. [실행](#실행-launch)
3. [선택 항목: Docker 이미지](#선택-항목-docker-이미지-docker-image)
4. [추가 매개변수](#추가-매개변수-extra-parameters)
5. [빌드](#빌드-building)

## 빠른 시작 (Quickstart)

Chat UI는 OpenAI 호환 API만 사용합니다. 가장 간단한 방법은 Hugging Face Inference Providers router와 개인 Hugging Face 토큰을 사용하는 것입니다.

1) `.env.local` 생성:

```env
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_************************
# 아래 데이터베이스 옵션 중 하나를 선택해 설정
MONGODB_URL=
```

`OPENAI_API_KEY`는 사용하려는 OpenAI 호환 엔드포인트에서 제공받은 키를 사용합니다. 환경에 맞는 예시는 다음과 같습니다.

| 제공자 | 예시 `OPENAI_BASE_URL` | 예시 Key |
|---|---|---|
| Hugging Face Inference Providers router | `https://router.huggingface.co/v1` | `OPENAI_API_KEY=hf_xxx` (`HF_TOKEN` 과거 호환) |
| llama.cpp server (`llama.cpp --server --api`) | `http://127.0.0.1:8080/v1` | `OPENAI_API_KEY=sk-local-demo` (임의 문자열) |
| Ollama (OpenAI 호환 브릿지) | `http://127.0.0.1:11434/v1` | `OPENAI_API_KEY=ollama` |
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENAI_API_KEY=sk-or-v1-...` |
| Poe | `https://api.poe.com/v1` | `OPENAI_API_KEY=pk_...` |

루트 [`.env` 템플릿](./.env)에서 선택적으로 사용할 수 있는 변수 목록을 확인할 수 있습니다.

1) MongoDB 위치 선택: Atlas(관리형) 또는 로컬 컨테이너 중 하나를 선택합니다. URI를 확보한 뒤 `MONGODB_URL`에 설정하고, 필요 시 `MONGODB_DB_NAME`을 지정합니다.

1) 설치 및 개발 서버 실행:

```bash
git clone https://github.com/huggingface/chat-ui
cd chat-ui
npm install
npm run dev -- --open
```

## 데이터베이스 옵션 (Database options)

채팅 기록, 사용자, 설정, 파일, 통계는 MongoDB에 저장됩니다. MongoDB 6/7 배포판을 사용할 수 있습니다.

### MongoDB Atlas (관리형)

1. [mongodb.com](https://www.mongodb.com/pricing)에서 무료 클러스터 생성
2. 네트워크 접근 허용(IP 또는 개발용 `0.0.0.0/0`)
3. 데이터베이스 사용자 생성 및 연결 문자열 복사
4. `.env.local`의 `MONGODB_URL`에 붙여넣기 (필요 시 `MONGODB_DB_NAME=chat-ui` 유지/변경)

Atlas는 로컬 환경을 건드리지 않고 팀/클라우드에 적합합니다.

### 로컬 MongoDB (컨테이너)

로컬에서 MongoDB를 구동하려면:

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

이후 `.env.local`에 `MONGODB_URL=mongodb://localhost:27017`를 설정하세요. 필요 시 `MONGO_STORAGE_PATH`로 임시 메모리 서버의 영속화 경로를 지정할 수 있습니다.

## 실행 (Launch)

환경 변수 설정 후 다음 명령으로 시작합니다:

```bash
npm install
npm run dev
```

기본 개발 서버 주소는 `http://localhost:5173` 입니다. 프로덕션 빌드는 `npm run build` / `npm run preview`로 수행합니다.

## 선택 항목: Docker 이미지 (Docker image)

컨테이너로 실행하려면 MongoDB URI만 제공하면 됩니다(로컬 또는 Atlas). 예:

```bash
docker run \
  -p 3000 \
  -e MONGODB_URL=mongodb://host.docker.internal:27017 \
  -e OPENAI_BASE_URL=https://router.huggingface.co/v1 \
  -e OPENAI_API_KEY=hf_*** \
  -v db:/data \
  ghcr.io/huggingface/chat-ui-db:latest
```

`host.docker.internal`은 컨테이너에서 호스트의 MongoDB에 접근할 때 사용합니다. Atlas를 사용할 경우 해당 URI로 대체하세요. `.env.local`에서 지원하는 모든 변수는 `-e`로 전달할 수 있습니다.

## 추가 매개변수 (Extra parameters)

### 테마 (Theming)

다음 환경 변수로 UI 이름/에셋/설명을 변경할 수 있습니다.

```env
PUBLIC_APP_NAME=ChatUI
PUBLIC_APP_ASSETS=chatui
PUBLIC_APP_DESCRIPTION="Making the community's best AI chat models available to everyone."
PUBLIC_APP_DATA_SHARING=
```

- `PUBLIC_APP_NAME`: 앱 전역 타이틀
- `PUBLIC_APP_ASSETS`: `static/$PUBLIC_APP_ASSETS`에서 로고/파비콘을 찾습니다. 기본값은 `chatui`(옵션: `huggingchat`).
- `PUBLIC_APP_DATA_SHARING`: `1`로 설정하면 사용자 설정에서 데이터 공유 옵트인 토글을 노출합니다.

### 모델 (Models)

이 빌드는 `MODELS` 환경 변수나 GGUF 디스커버리를 사용하지 않습니다. `OPENAI_BASE_URL`의 `/models` 응답으로 모델 목록을 구성합니다. 인증은 `OPENAI_API_KEY`(권장)이며, `HF_TOKEN`은 레거시 별칭입니다.

### LLM 라우터 (선택)

별도 라우터 서비스를 띄우지 않고 클라이언트 사이드 라우팅을 사용할 수 있습니다(Arch Router 기반). UI에는 가상 모델 별칭(기본 `Omni`)이 노출되며, 선택 시 최근 대화를 바탕으로 적절한 라우트/모델을 고릅니다.

- 라우팅 정책 JSON 제공: `LLM_ROUTER_ROUTES_PATH` (자체 JSON 배열 준비 필요)
- Arch 선택 엔드포인트(OpenAI 호환 `/chat/completions`): `LLM_ROUTER_ARCH_BASE_URL`, 모델: `LLM_ROUTER_ARCH_MODEL`
- 기타 라우트 매핑: `LLM_ROUTER_OTHER_ROUTE` (기본 `casual_conversation`), 실패 시 `LLM_ROUTER_FALLBACK_MODEL`
- 타임아웃: `LLM_ROUTER_ARCH_TIMEOUT_MS` (기본 10000)
- 별칭/표시명/로고: `PUBLIC_LLM_ROUTER_ALIAS_ID`(기본 `omni`), `PUBLIC_LLM_ROUTER_DISPLAY_NAME`(기본 `Omni`), `PUBLIC_LLM_ROUTER_LOGO_URL`(선택)

동작 개요:

- 최근 턴을 기반으로 Arch 엔드포인트에 1회 호출(논-스트리밍)하여 라우트를 선정
- 선택 결과(라우트/실제 모델)를 즉시 UI에 표시
- 선택된 모델로 스트리밍, 오류 시 라우트 폴백 시도

## 빌드 (Building)

프로덕션 빌드 생성:

```bash
npm run build
```

프로덕션 빌드 프리뷰:

```bash
npm run preview
```

배포 시 대상 환경에 맞는 [adapter](https://kit.svelte.dev/docs/adapters)가 필요할 수 있습니다.
