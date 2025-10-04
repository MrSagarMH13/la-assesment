// Manual test script for local testing without running server
// Usage: Add your ANTHROPIC_API_KEY to .env then run: node test-manual.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function testExtraction() {
  // Dynamic imports for ESM modules
  const { FileProcessor } = await import('./dist/utils/fileProcessor.js');
  const { ClaudeService } = await import('./dist/services/claudeService.js');

  const testFiles = [
    {
      path: '/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 1.2.png',
      metadata: { teacherName: 'Miss Joynes', className: '2EJ' }
    },
    {
      path: '/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 3.png',
      metadata: {}
    },
    {
      path: '/Users/sagar/Downloads/TA Assignment Pack/Teacher Timetable Example 4.jpeg',
      metadata: {}
    }
  ];

  const claudeService = new ClaudeService();

  for (const testFile of testFiles) {
    console.log(`\n📄 Testing: ${path.basename(testFile.path)}`);
    console.log('='.repeat(60));

    try {
      // Get mime type
      const ext = path.extname(testFile.path).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.pdf': 'application/pdf'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      // Process file
      const processed = await FileProcessor.processFile(
        testFile.path,
        mimeType,
        path.basename(testFile.path)
      );

      // Extract timetable
      const result = await claudeService.extractTimetable(processed, testFile.metadata);

      console.log('\n✅ Extraction successful!');
      console.log('\nMetadata:', JSON.stringify(result.metadata, null, 2));
      console.log(`\nBlocks found: ${result.blocks.length}`);
      console.log(`Recurring blocks: ${result.recurringBlocks?.length || 0}`);

      if (result.warnings?.length) {
        console.log('\n⚠️  Warnings:', result.warnings);
      }

      // Show first few blocks
      console.log('\nSample blocks:');
      result.blocks.slice(0, 3).forEach(block => {
        console.log(`  - ${block.day} ${block.startTime}-${block.endTime}: ${block.eventName}`);
      });

    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }
}

testExtraction().catch(console.error);
