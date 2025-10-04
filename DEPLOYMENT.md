# Deployment Guide - Timetable Extraction API

## Production Architecture Overview

```
                            ┌──────────────────┐
                            │   Load Balancer  │
                            │   (AWS ALB/      │
                            │    nginx)        │
                            └────────┬─────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
           ┌──────▼──────┐    ┌─────▼──────┐   ┌─────▼──────┐
           │  API Node 1 │    │ API Node 2 │   │ API Node N │
           │  (ECS/K8s)  │    │  (ECS/K8s) │   │  (ECS/K8s) │
           └──────┬──────┘    └─────┬──────┘   └─────┬──────┘
                  │                  │                │
                  └──────────────────┼────────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
                  ▼                  ▼                  ▼
          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
          │   AWS SQS    │   │      S3      │   │  PostgreSQL  │
          │   Queue      │   │   Bucket     │   │   (RDS)      │
          └──────┬───────┘   └──────────────┘   └──────────────┘
                 │
                 │ (Poll messages)
                 │
      ┌──────────┼──────────┐
      │          │          │
┌─────▼─────┐ ┌──▼──────┐ ┌▼──────────┐
│  Worker 1 │ │ Worker 2│ │ Worker N  │
│  (ECS/K8s)│ │(ECS/K8s)│ │ (ECS/K8s) │
└───────────┘ └─────────┘ └───────────┘
      │             │             │
      └─────────────┼─────────────┘
                    │
           ┌────────┼────────┐
           │        │        │
           ▼        ▼        ▼
    ┌──────────┐ ┌────────┐ ┌────────┐
    │Document  │ │ Claude │ │  S3    │
    │   AI     │ │   API  │ │Results │
    └──────────┘ └────────┘ └────────┘
```

---

## Table of Contents
1. [Local Development Setup](#local-development-setup)
2. [AWS Production Deployment](#aws-production-deployment)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [Scaling Strategies](#scaling-strategies)
5. [Monitoring & Logging](#monitoring--logging)
6. [Cost Optimization](#cost-optimization)
7. [Security Best Practices](#security-best-practices)

---

## 1. Local Development Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- AWS CLI (for LocalStack)
- Google Cloud SDK (if using Document AI)

### Quick Start

```bash
# 1. Clone repository
git clone <your-repo>
cd assesment

# 2. Copy environment variables
cp .env.example .env

# 3. Configure .env with your API keys
# - ANTHROPIC_API_KEY
# - GOOGLE_PROJECT_ID, GOOGLE_PROCESSOR_ID (if using Document AI)

# 4. Start all services with Docker Compose
docker-compose up -d

# 5. Setup LocalStack (S3 + SQS)
./setup-localstack.sh

# 6. Run database migrations
docker-compose exec api npm run prisma:push

# 7. Access the API
curl http://localhost:3000
```

### Verify Services

```bash
# Check API health
curl http://localhost:3000/api/v2/timetable/health

# Check PostgreSQL
docker-compose exec postgres psql -U timetable_user -d timetable_extraction -c "\dt"

# Check Redis
docker-compose exec redis redis-cli ping

# Check LocalStack S3
aws --endpoint-url=http://localhost:4566 s3 ls

# Check SQS
aws --endpoint-url=http://localhost:4566 sqs list-queues
```

### Development Workflow

```bash
# Run API in development mode (hot reload)
npm run dev

# Run worker in development mode
npm run dev:worker

# Run both simultaneously
npm run start:all

# Build for production
npm run build

# Run tests
npm test
```

---

## 2. AWS Production Deployment

### Architecture Components

**Compute:**
- AWS ECS Fargate (API + Workers) or EC2 + Auto Scaling Groups
- Application Load Balancer (ALB)

**Storage:**
- Amazon S3 (file storage)
- Amazon RDS PostgreSQL (database)
- Amazon ElastiCache Redis (caching)

**Queue:**
- Amazon SQS (job queue)
- Amazon SQS DLQ (dead letter queue)

**AI Services:**
- Google Cloud Document AI (via API)
- Anthropic Claude (via API)

### Step 1: Setup AWS Infrastructure

#### 1.1 Create S3 Bucket

```bash
aws s3 mb s3://your-company-timetable-uploads --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket your-company-timetable-uploads \
  --versioning-configuration Status=Enabled

# Enable lifecycle policy (auto-delete old files after 90 days)
aws s3api put-bucket-lifecycle-configuration \
  --bucket your-company-timetable-uploads \
  --lifecycle-configuration file://s3-lifecycle.json
```

**s3-lifecycle.json:**
```json
{
  "Rules": [
    {
      "Id": "DeleteOldUploads",
      "Status": "Enabled",
      "Expiration": {
        "Days": 90
      },
      "Filter": {
        "Prefix": "uploads/"
      }
    }
  ]
}
```

#### 1.2 Create SQS Queues

```bash
# Create main queue
aws sqs create-queue \
  --queue-name timetable-extraction-queue \
  --attributes VisibilityTimeout=300,MessageRetentionPeriod=1209600

# Create Dead Letter Queue
aws sqs create-queue \
  --queue-name timetable-extraction-dlq \
  --attributes MessageRetentionPeriod=1209600

# Configure DLQ on main queue
MAIN_QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT/timetable-extraction-queue \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT/timetable-extraction-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT/timetable-extraction-queue \
  --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"'$DLQ_ARN'\",\"maxReceiveCount\":\"3\"}"}'
```

#### 1.3 Create RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier timetable-extraction-db \
  --db-instance-class db.t4g.medium \
  --engine postgres \
  --engine-version 15.3 \
  --master-username admin \
  --master-user-password YOUR_PASSWORD \
  --allocated-storage 20 \
  --storage-type gp3 \
  --vpc-security-group-ids sg-XXXXXXXX \
  --db-subnet-group-name your-subnet-group \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "sun:04:00-sun:05:00" \
  --multi-az \
  --publicly-accessible false
```

#### 1.4 Create ElastiCache Redis

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id timetable-extraction-redis \
  --cache-node-type cache.t4g.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --cache-subnet-group-name your-subnet-group \
  --security-group-ids sg-XXXXXXXX
```

### Step 2: Deploy to ECS Fargate

#### 2.1 Build and Push Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Create ECR repository
aws ecr create-repository --repository-name timetable-extraction-api

# Build image
docker build -t timetable-extraction-api .

# Tag image
docker tag timetable-extraction-api:latest YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/timetable-extraction-api:latest

# Push image
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/timetable-extraction-api:latest
```

#### 2.2 Create ECS Task Definitions

**API Task Definition (task-def-api.json):**
```json
{
  "family": "timetable-extraction-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/timetable-extraction-api:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3000"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/timetable-extraction-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

**Worker Task Definition (task-def-worker.json):**
```json
{
  "family": "timetable-extraction-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/timetable-extraction-api:latest",
      "essential": true,
      "command": ["node", "dist/worker.js"],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "WORKER_CONCURRENCY", "value": "10"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/timetable-extraction-worker",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "worker"
        }
      }
    }
  ]
}
```

#### 2.3 Create ECS Services

```bash
# Register task definitions
aws ecs register-task-definition --cli-input-json file://task-def-api.json
aws ecs register-task-definition --cli-input-json file://task-def-worker.json

# Create ECS cluster
aws ecs create-cluster --cluster-name timetable-extraction-cluster

# Create API service (with ALB)
aws ecs create-service \
  --cluster timetable-extraction-cluster \
  --service-name api-service \
  --task-definition timetable-extraction-api \
  --desired-count 3 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=api,containerPort=3000"

# Create Worker service (no ALB)
aws ecs create-service \
  --cluster timetable-extraction-cluster \
  --service-name worker-service \
  --task-definition timetable-extraction-worker \
  --desired-count 5 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

---

## 3. Kubernetes Deployment

### Kubernetes Manifests

**Namespace:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: timetable-extraction
```

**ConfigMap:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: timetable-config
  namespace: timetable-extraction
data:
  NODE_ENV: "production"
  PORT: "3000"
  WORKER_CONCURRENCY: "10"
  USE_DOCUMENT_AI: "true"
  USE_CLAUDE_FALLBACK: "true"
  USE_HYBRID_MODE: "true"
```

**Secrets:**
```bash
kubectl create secret generic timetable-secrets \
  --from-literal=DATABASE_URL="postgresql://..." \
  --from-literal=ANTHROPIC_API_KEY="sk-..." \
  --from-literal=AWS_ACCESS_KEY_ID="..." \
  --from-literal=AWS_SECRET_ACCESS_KEY="..." \
  -n timetable-extraction
```

**API Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: timetable-extraction
spec:
  replicas: 3
  selector:
    matchLabels:
      app: timetable-api
  template:
    metadata:
      labels:
        app: timetable-api
    spec:
      containers:
      - name: api
        image: your-registry/timetable-extraction-api:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: timetable-config
        - secretRef:
            name: timetable-secrets
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /api/v2/timetable/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v2/timetable/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

**Worker Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: timetable-extraction
spec:
  replicas: 5
  selector:
    matchLabels:
      app: timetable-worker
  template:
    metadata:
      labels:
        app: timetable-worker
    spec:
      containers:
      - name: worker
        image: your-registry/timetable-extraction-api:latest
        command: ["node", "dist/worker.js"]
        envFrom:
        - configMapRef:
            name: timetable-config
        - secretRef:
            name: timetable-secrets
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
```

**Service & Ingress:**
```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: api-service
  namespace: timetable-extraction
spec:
  selector:
    app: timetable-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: timetable-extraction
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts:
    - api.yourdomain.com
    secretName: timetable-tls
  rules:
  - host: api.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 80
```

**Horizontal Pod Autoscaler:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: timetable-extraction
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 4. Scaling Strategies

### Horizontal Scaling

**API Servers:**
- Scale based on CPU/memory usage (70% threshold)
- Scale based on request rate (HTTP requests per second)
- Min replicas: 3
- Max replicas: 20

**Workers:**
- Scale based on SQS queue depth
- Scale based on message age
- Target: Each worker processes 10 jobs/minute
- Formula: `desired_workers = queue_depth / (10 * 60)`
- Min replicas: 5
- Max replicas: 50

**SQS-Based Auto Scaling (CloudWatch Alarm):**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name high-queue-depth \
  --alarm-description "Scale workers when queue has many messages" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=QueueName,Value=timetable-extraction-queue \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:autoscaling:us-east-1:123456789012:scalingPolicy:...
```

### Vertical Scaling

**Database (RDS):**
- Start: db.t4g.medium (2 vCPU, 4GB RAM)
- Scale to: db.m6g.xlarge (4 vCPU, 16GB RAM) when needed

**Redis:**
- Start: cache.t4g.micro (2 cores, 0.5GB)
- Scale to: cache.r6g.large (2 cores, 13.5GB) when caching heavily

### Cost Optimization

1. **Use Spot Instances for Workers** (70% cost savings)
2. **S3 Lifecycle Policies** (move old files to Glacier after 30 days)
3. **RDS Reserved Instances** (up to 60% savings for 1-year commit)
4. **CloudFront CDN** (cache static assets)
5. **Document AI Tier** (use batch API for non-urgent requests)

---

## 5. Monitoring & Logging

### CloudWatch Metrics

**API Metrics:**
- HTTP request count
- HTTP error rate (4xx, 5xx)
- Request latency (p50, p95, p99)
- CPU and memory utilization

**Worker Metrics:**
- Jobs processed per minute
- Job success rate
- Job failure rate
- Retry rate
- Processing time (average, p95, p99)

**SQS Metrics:**
- Queue depth
- Message age
- Messages sent/received
- DLQ depth (alert if > 0)

### Logging Stack

**CloudWatch Logs:**
```javascript
// In production code
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.CloudWatch({
      logGroupName: '/ecs/timetable-extraction',
      logStreamName: `${process.env.NODE_ENV}-${Date.now()}`
    })
  ]
});
```

**Log Aggregation (Optional - ELK Stack):**
- Elasticsearch for log storage
- Logstash for log processing
- Kibana for visualization

### Alerting

**PagerDuty / SNS Alerts:**
- DLQ has messages (critical)
- Error rate > 5% (warning)
- API latency > 5s (warning)
- Database connection errors (critical)
- Worker crashes (critical)

---

## 6. Security Best Practices

### API Security
- ✅ HTTPS only (TLS 1.2+)
- ✅ API key authentication
- ✅ Rate limiting (AWS WAF / nginx)
- ✅ CORS configuration (whitelist origins)
- ✅ Input validation (Zod schemas)
- ✅ SQL injection prevention (Prisma ORM)

### Data Security
- ✅ S3 bucket encryption at rest (AES-256)
- ✅ RDS encryption at rest
- ✅ Secrets in AWS Secrets Manager (not env vars)
- ✅ IAM roles (least privilege)
- ✅ VPC private subnets for workers

### Compliance
- ✅ GDPR: Data retention policy (auto-delete after 90 days)
- ✅ FERPA: Student data encryption
- ✅ SOC 2: Audit logging enabled

---

## 7. CI/CD Pipeline

### GitHub Actions Example

**.github/workflows/deploy.yml:**
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build, tag, and push image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/timetable-extraction-api:$IMAGE_TAG .
          docker push $ECR_REGISTRY/timetable-extraction-api:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster timetable-extraction-cluster \
            --service api-service --force-new-deployment
          aws ecs update-service --cluster timetable-extraction-cluster \
            --service worker-service --force-new-deployment
```

---

## Performance Benchmarks

**Expected Throughput:**
- API: 1000 requests/second (3 API nodes)
- Workers: 500 jobs/minute (5 workers @ 10 jobs/min each)
- Database: 5000 queries/second (RDS db.m6g.xlarge)

**Expected Latency:**
- API response (job submission): < 200ms
- Document AI extraction: 1-3 seconds
- Claude extraction: 2-5 seconds
- Hybrid extraction: 3-6 seconds

**Cost Estimates (per month):**
- ECS Fargate API (3 tasks): ~$130
- ECS Fargate Workers (5 tasks): ~$220
- RDS PostgreSQL (db.m6g.xlarge): ~$200
- S3 Storage (1TB): ~$23
- Data Transfer: ~$50
- Document AI (10k pages): ~$15
- Claude API (10k requests): ~$150
- **Total: ~$790/month** (for 10k timetables/month)

---

**For detailed troubleshooting, see TROUBLESHOOTING.md**
