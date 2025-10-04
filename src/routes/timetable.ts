import { Router, Request, Response, NextFunction } from 'express';
import { upload } from '../middleware/upload';
import { FileProcessor } from '../utils/fileProcessor';
import { ClaudeService } from '../services/claudeService';
import { TimetableResponseSchema } from '../types/timetable';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const claudeService = new ClaudeService();

router.post('/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  let filePath: string | undefined;

  try {
    // Validate file upload
    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    filePath = req.file.path;
    const { mimetype: mimeType, originalname: originalName } = req.file;

    // Extract optional metadata from request body
    const teacherName = req.body.teacherName;
    const className = req.body.className;

    console.log(`Processing file: ${originalName} (${mimeType})`);

    // Step 1: Process the file (OCR, text extraction, image preparation)
    const processedFile = await FileProcessor.processFile(filePath, mimeType, originalName);
    console.log('File processed successfully');

    // Step 2: Extract timetable data using Claude
    const extractedData = await claudeService.extractTimetable(processedFile, {
      teacherName,
      className
    });
    console.log('Timetable extracted successfully');

    // Step 3: Build response
    const response = {
      success: true,
      data: {
        timetableId: `tt-${Date.now()}`, // In production, this would be a database ID
        metadata: {
          ...extractedData.metadata,
          extractedAt: new Date().toISOString()
        },
        blocks: extractedData.blocks,
        recurringBlocks: extractedData.recurringBlocks || [],
        warnings: extractedData.warnings || []
      }
    };

    // Validate response
    const validatedResponse = TimetableResponseSchema.parse(response);

    // Cleanup uploaded file
    await FileProcessor.cleanup(filePath);

    res.json(validatedResponse);
  } catch (error) {
    // Cleanup on error
    if (filePath) {
      await FileProcessor.cleanup(filePath);
    }

    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Extraction failed'));
  }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'timetable-extraction-api' });
});

export default router;
