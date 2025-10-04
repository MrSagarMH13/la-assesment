#!/bin/bash

# Setup script for LocalStack (local AWS services)
# Creates S3 bucket and SQS queues

echo "⏳ Waiting for LocalStack to be ready..."
sleep 10

ENDPOINT="http://localhost:4566"
AWS_REGION="us-east-1"

echo "🪣 Creating S3 bucket..."
aws --endpoint-url=$ENDPOINT s3 mb s3://timetable-uploads --region $AWS_REGION

echo "📬 Creating SQS queue..."
aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name timetable-extraction-queue \
  --region $AWS_REGION

echo "💀 Creating Dead Letter Queue..."
DLQ_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name timetable-extraction-dlq \
  --region $AWS_REGION \
  --query 'QueueUrl' \
  --output text)

echo "DLQ created: $DLQ_URL"

echo "✅ LocalStack setup complete!"
echo ""
echo "S3 Bucket: timetable-uploads"
echo "SQS Queue: timetable-extraction-queue"
echo "SQS DLQ: timetable-extraction-dlq"
