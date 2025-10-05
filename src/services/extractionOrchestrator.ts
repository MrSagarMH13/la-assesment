import { ProcessedFile, FileProcessor } from '../utils/fileProcessor';
import { ComplexityAnalyzer, ComplexityAnalysis } from './complexityAnalyzer';
import { DocumentAIService } from './documentAIService';
import { ClaudeService } from './claudeService';
import { ExtractedData } from '../types/timetable';

export interface ExtractionResult {
  data: ExtractedData;
  method: string;
  complexity: ComplexityAnalysis;
  processingTime: number;
}

/**
 * Orchestrates the hybrid extraction pipeline:
 * 1. Analyze complexity
 * 2. Route to appropriate service (Document AI / Claude / Hybrid)
 * 3. Return results with metadata
 */
export class ExtractionOrchestrator {
  private complexityAnalyzer: ComplexityAnalyzer;
  private documentAI: DocumentAIService;
  private claude: ClaudeService;

  constructor() {
    this.complexityAnalyzer = new ComplexityAnalyzer();
    this.documentAI = new DocumentAIService();
    this.claude = new ClaudeService();
  }

  /**
   * Main extraction method - intelligently routes based on complexity
   */
  async extract(
    processedFile: ProcessedFile,
    metadata?: { teacherName?: string; className?: string }
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // Step 1: Analyze complexity
      console.log('Analyzing file complexity...');
      const complexity = await this.complexityAnalyzer.analyze(processedFile);
      console.log(`Complexity: ${complexity.level} (score: ${complexity.score.toFixed(2)})`);
      console.log(`Recommended method: ${complexity.recommendedMethod}`);

      let extractedData: ExtractedData;
      let method: string;

      // Step 2: Route based on complexity and feature flags
      const useDocumentAI = process.env.USE_DOCUMENT_AI === 'true';
      const useClaudeFallback = process.env.USE_CLAUDE_FALLBACK === 'true';
      const useHybrid = process.env.USE_HYBRID_MODE === 'true';

      // If Document AI is disabled, always use Claude regardless of complexity
      if (!useDocumentAI) {
        console.log('Document AI disabled, using Claude Vision...');
        extractedData = await this.claude.extractTimetable(processedFile, metadata);
        method = 'claude';

      } else if (complexity.recommendedMethod === 'document_ai') {
        // Simple case: Document AI only
        console.log('Using Google Document AI (fast path)...');
        extractedData = await this.documentAI.extractTimetable(processedFile, metadata);
        method = 'document_ai';

      } else if (complexity.recommendedMethod === 'claude') {
        // Complex case: Claude only
        console.log('Using Claude Vision (complex path)...');
        extractedData = await this.claude.extractTimetable(processedFile, metadata);
        method = 'claude';

      } else if (complexity.recommendedMethod === 'hybrid' && useHybrid) {
        // Medium case: Hybrid (Document AI + Claude validation)
        console.log('Using hybrid extraction (Document AI + Claude validation)...');

        // First pass: Document AI
        const docAIData = await this.documentAI.extractTimetable(processedFile, metadata);

        // Second pass: Claude validates and enhances
        if (useClaudeFallback) {
          extractedData = await this.claude.validateExtraction(docAIData, processedFile);
          method = 'hybrid_documentai_claude';
        } else {
          extractedData = docAIData;
          method = 'document_ai';
        }

      } else {
        // Default fallback: Use Claude
        console.log('Using Claude as default extraction method...');
        extractedData = await this.claude.extractTimetable(processedFile, metadata);
        method = 'claude_fallback';
      }

      const processingTime = Date.now() - startTime;

      console.log(`Extraction completed in ${processingTime}ms`);
      console.log(`Extracted ${extractedData.blocks.length} time blocks`);

      return {
        data: extractedData,
        method,
        complexity,
        processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;

      // If primary extraction fails, try fallback
      if (process.env.USE_CLAUDE_FALLBACK === 'true') {
        console.log('Primary extraction failed, trying Claude fallback...');
        try {
          const extractedData = await this.claude.extractTimetable(processedFile, metadata);
          return {
            data: extractedData,
            method: 'claude_error_fallback',
            complexity: {
              level: 'complex',
              score: 1,
              reasons: ['Primary extraction failed'],
              recommendedMethod: 'claude'
            },
            processingTime: Date.now() - startTime
          };
        } catch (fallbackError) {
          throw new Error(`All extraction methods failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      throw error;
    }
  }
}
