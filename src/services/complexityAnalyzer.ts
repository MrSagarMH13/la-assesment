import { ProcessedFile } from '../utils/fileProcessor';
import Tesseract from 'tesseract.js';

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export interface ComplexityAnalysis {
  level: ComplexityLevel;
  score: number; // 0-1, higher = more complex
  reasons: string[];
  recommendedMethod: 'document_ai' | 'claude' | 'hybrid';
}

export class ComplexityAnalyzer {
  /**
   * Analyze file complexity to determine best extraction method
   */
  async analyze(processedFile: ProcessedFile): Promise<ComplexityAnalysis> {
    const factors = {
      hasLowOCRConfidence: false,
      hasHandwriting: false,
      hasComplexLayout: false,
      hasColorCoding: false,
      hasMergedCells: false,
      hasVerticalText: false,
      isLowQuality: false
    };

    const reasons: string[] = [];

    // Factor 1: OCR Confidence (if OCR was performed)
    if (processedFile.text) {
      const avgConfidence = await this.estimateOCRConfidence(processedFile);
      if (avgConfidence < 0.7) {
        factors.hasLowOCRConfidence = true;
        reasons.push('Low OCR confidence detected');
      }
    }

    // Factor 2: File type analysis
    if (processedFile.mimeType.includes('pdf')) {
      // PDFs can be either simple (typed) or complex (scanned)
      // Check if it's a scanned PDF vs native PDF
      const isScanned = await this.isScannedPDF(processedFile);
      if (isScanned) {
        factors.isLowQuality = true;
        reasons.push('Scanned PDF detected');
      }
    }

    // Factor 3: Image quality (for images)
    if (processedFile.mimeType.startsWith('image/') && processedFile.imageBuffer) {
      const quality = await this.analyzeImageQuality(processedFile.imageBuffer);
      if (quality < 0.6) {
        factors.isLowQuality = true;
        reasons.push('Low image quality');
      }
    }

    // Factor 4: Text analysis for handwriting indicators
    if (processedFile.text) {
      const hasHandwriting = this.detectHandwritingIndicators(processedFile.text);
      if (hasHandwriting) {
        factors.hasHandwriting = true;
        reasons.push('Possible handwritten content');
      }
    }

    // Factor 5: Layout complexity (simplified heuristic)
    if (processedFile.text) {
      const layoutComplexity = this.analyzeLayoutComplexity(processedFile.text);
      if (layoutComplexity > 0.7) {
        factors.hasComplexLayout = true;
        reasons.push('Complex table layout');
      }
    }

    // Calculate complexity score (0-1)
    const score = this.calculateComplexityScore(factors);

    // Determine complexity level
    let level: ComplexityLevel;
    if (score < 0.3) {
      level = 'simple';
    } else if (score < 0.6) {
      level = 'medium';
    } else {
      level = 'complex';
    }

    // Recommend extraction method
    const recommendedMethod = this.recommendMethod(level, factors);

    return {
      level,
      score,
      reasons,
      recommendedMethod
    };
  }

  /**
   * Estimate OCR confidence from processed text
   */
  private async estimateOCRConfidence(processedFile: ProcessedFile): Promise<number> {
    // Simple heuristic: check for common OCR errors
    const text = processedFile.text || '';

    // Count potential OCR errors
    let errorIndicators = 0;
    const totalWords = text.split(/\s+/).length;

    // Check for excessive punctuation (OCR noise)
    const punctuationRatio = (text.match(/[^\w\s]/g) || []).length / text.length;
    if (punctuationRatio > 0.2) errorIndicators += 10;

    // Check for excessive single characters
    const singleChars = text.match(/\b\w\b/g) || [];
    if (singleChars.length / totalWords > 0.3) errorIndicators += 10;

    // Check for nonsense words (no vowels)
    const words = text.match(/\b\w{3,}\b/g) || [];
    const noVowelWords = words.filter(w => !/[aeiou]/i.test(w));
    if (noVowelWords.length / words.length > 0.2) errorIndicators += 10;

    // Return confidence (1 = perfect, 0 = terrible)
    return Math.max(0, 1 - (errorIndicators / 30));
  }

  /**
   * Check if PDF is scanned (image-based) vs native (text-based)
   */
  private async isScannedPDF(processedFile: ProcessedFile): Promise<boolean> {
    // If we have very little extracted text, it's likely scanned
    const textLength = processedFile.text?.length || 0;
    return textLength < 100;
  }

  /**
   * Analyze image quality (simplified)
   */
  private async analyzeImageQuality(buffer: Buffer): Promise<number> {
    // Placeholder: In production, use sharp to analyze resolution, contrast, etc.
    // For now, return neutral score
    return 0.7;
  }

  /**
   * Detect handwriting indicators in text
   */
  private detectHandwritingIndicators(text: string): boolean {
    // Handwriting often has:
    // - Inconsistent capitalization
    // - OCR confusion characters
    // - Lower overall structure

    const hasInconsistentCaps = /[a-z][A-Z]/.test(text);
    const hasOCRConfusion = /[Il1O0]/.test(text); // Common OCR confusions

    return hasInconsistentCaps && hasOCRConfusion;
  }

  /**
   * Analyze layout complexity from text structure
   */
  private analyzeLayoutComplexity(text: string): number {
    // Count newlines, spaces, special characters
    const lines = text.split('\n').length;
    const avgLineLength = text.length / lines;

    // Very short lines suggest complex table structure
    if (avgLineLength < 20) return 0.8;
    if (avgLineLength < 40) return 0.5;
    return 0.3;
  }

  /**
   * Calculate overall complexity score from factors
   */
  private calculateComplexityScore(factors: Record<string, boolean>): number {
    const weights = {
      hasLowOCRConfidence: 0.25,
      hasHandwriting: 0.3,
      hasComplexLayout: 0.15,
      hasColorCoding: 0.1,
      hasMergedCells: 0.1,
      hasVerticalText: 0.05,
      isLowQuality: 0.05
    };

    let score = 0;
    for (const [factor, active] of Object.entries(factors)) {
      if (active && weights[factor as keyof typeof weights]) {
        score += weights[factor as keyof typeof weights];
      }
    }

    return Math.min(1, score);
  }

  /**
   * Recommend extraction method based on complexity
   */
  private recommendMethod(level: ComplexityLevel, factors: Record<string, boolean>): 'document_ai' | 'claude' | 'hybrid' {
    // Simple: Document AI only (fast & cheap)
    if (level === 'simple') {
      return 'document_ai';
    }

    // Complex: Claude only (smart & expensive)
    if (level === 'complex' || factors.hasHandwriting) {
      return 'claude';
    }

    // Medium: Hybrid (Document AI + Claude validation)
    return 'hybrid';
  }
}
