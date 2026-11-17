.PHONY: db api seed web test build ios android

API_URL_IOS ?= http://localhost:8080/api/v1
# 10.0.2.2 is this machine, as seen from the Android emulator.
API_URL_ANDROID ?= http://10.0.2.2:8080/api/v1
CAP_DEV ?= 1
.DEFAULT_GOAL := db

ios:           ## Build and open the iOS app. For a real server: make ios API_URL_IOS=https://...
	cd frontend && VITE_API_URL=$(API_URL_IOS) npm run build && npx cap sync ios && npx cap open ios

android:       ## Build and open the Android app. For release: make android API_URL_ANDROID=https://... CAP_DEV=0
	cd frontend && VITE_API_URL=$(API_URL_ANDROID) npm run build && CAP_DEV=$(CAP_DEV) npx cap sync android && npx cap open android

db:            ## Start Postgres (port 5433)
	docker compose up -d postgres

api: db        ## Run the Go API on :8080 (migrates on start)
	cd backend && go run ./cmd/api

seed: db       ## Create demo owner + The Harbour House with 15 rooms
	cd backend && go run ./cmd/seed

web:           ## Run the frontend on :5180
	cd frontend && npm run dev

test:          ## Backend tests + frontend typecheck
	cd backend && go vet ./... && go test ./...
	cd frontend && npx tsc -b && npm test

build:
	cd backend && go build -o bin/api ./cmd/api
	cd frontend && npm run build
