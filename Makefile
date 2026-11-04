.PHONY: db api seed web test build

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
	cd frontend && npx tsc -b

build:
	cd backend && go build -o bin/api ./cmd/api
	cd frontend && npm run build
