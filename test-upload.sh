#!/bin/bash

# Test script for timetable extraction API
# Make sure to set your ANTHROPIC_API_KEY in .env before running

API_URL="http://localhost:3000/api/timetable/upload"

echo "🧪 Testing Timetable Extraction API"
echo "===================================="

# Test 1: Teacher Timetable Example 1.2.png
echo ""
echo "📤 Test 1: Uploading Teacher Timetable Example 1.2.png..."
curl -X POST "$API_URL" \
  -F "file=@/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 1.2.png" \
  -F "teacherName=Miss Joynes" \
  -F "className=2EJ" \
  | jq '.'

echo ""
echo "---"

# Test 2: Teacher Timetable Example 3.png
echo ""
echo "📤 Test 2: Uploading Teacher Timetable Example 3.png..."
curl -X POST "$API_URL" \
  -F "file=@/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 3.png" \
  | jq '.'

echo ""
echo "---"

# Test 3: Teacher Timetable Example 4.jpeg
echo ""
echo "📤 Test 3: Uploading Teacher Timetable Example 4.jpeg..."
curl -X POST "$API_URL" \
  -F "file=@/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 4.jpeg" \
  | jq '.'

echo ""
echo "===================================="
echo "✅ Tests completed!"
