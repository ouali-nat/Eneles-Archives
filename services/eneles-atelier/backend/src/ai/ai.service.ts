import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { signInternalRequest } from '../common/internal-hmac';

/** Where Axya, the research AI behind PDF extraction and dictation, is served. */
const AXYA_DEFAULT_URL = 'https://ai.axya.org';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly fallbackInstance: AxiosInstance | null;
  private readonly aiBaseUrl: string;
  private readonly aiFallbackUrl: string | null;
  private readonly internalApiSecret: string | null;
  private readonly defaultServiceId = 'marker';

  constructor(private configService: ConfigService) {
    this.aiBaseUrl = this.resolveAxyaUrl();
    this.aiFallbackUrl =
      this.configService.get<string>('AI_FALLBACK_URL') || null;
    this.internalApiSecret =
      this.configService.get<string>('INTERNAL_API_SECRET') || null;

    this.axiosInstance = axios.create({
      baseURL: this.aiBaseUrl,
      timeout: 300000,
    });
    this.addHmacInterceptor(this.axiosInstance);

    if (this.aiFallbackUrl) {
      this.fallbackInstance = axios.create({
        baseURL: this.aiFallbackUrl,
        timeout: 300000,
      });
      this.addHmacInterceptor(this.fallbackInstance);
    } else {
      this.fallbackInstance = null;
    }
  }

  /**
   * Axya, the research AI that extracts PDFs and transcribes speech, lives at
   * ai.axya.org. It used to be called Axeom, so the old variable name and
   * host are still understood: a configuration that points at the retired
   * ai.axeom.org host is sent to ai.axya.org, with a warning to update it.
   */
  private resolveAxyaUrl(): string {
    const configured =
      this.configService.get<string>('AXYA_SERVICE_URL') ||
      this.configService.get<string>('AXEOM_SERVICE_URL');
    if (!configured) return AXYA_DEFAULT_URL;
    try {
      const url = new URL(configured);
      if (url.hostname === 'ai.axeom.org') {
        this.logger.warn(
          'The Axya service URL points at ai.axeom.org, which moved; using https://ai.axya.org. Set AXYA_SERVICE_URL to silence this.',
        );
        return AXYA_DEFAULT_URL;
      }
    } catch {
      // Not a URL; let the HTTP client report it on first use.
    }
    return configured;
  }

  /**
   * Signs every request to the Axya service over its exact body (common/internal-hmac.ts). The body is turned into the bytes that go on the wire here, before signing: a multipart form is built into one buffer and sent as that buffer with its boundary in Content-Type; an object is serialized once and sent as that exact JSON string; a string or buffer is sent as it is; no body is the empty string. The path is signed without its query string, as the service checks it.
   */
  private addHmacInterceptor(instance: AxiosInstance): void {
    instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (!this.internalApiSecret) {
        this.warnUnsigned();
        return config;
      }
      const method = (config.method || 'GET').toUpperCase();
      let body: Buffer | string = '';
      const data: unknown = config.data;
      if (data instanceof FormData) {
        const buffer = data.getBuffer();
        config.headers.set(
          'Content-Type',
          `multipart/form-data; boundary=${data.getBoundary()}`,
        );
        config.headers.set('Content-Length', String(buffer.length));
        config.data = buffer;
        body = buffer;
      } else if (Buffer.isBuffer(data) || typeof data === 'string') {
        body = data;
      } else if (data !== undefined && data !== null) {
        const json = JSON.stringify(data);
        config.headers.set('Content-Type', 'application/json');
        config.data = json;
        body = json;
      }
      const path = new URL(config.url || '/', config.baseURL || this.aiBaseUrl)
        .pathname;
      const headers = signInternalRequest(
        this.internalApiSecret,
        method,
        path,
        body,
      );
      for (const [name, value] of Object.entries(headers)) {
        config.headers.set(name, value);
      }
      return config;
    });
  }

  private warnedUnsigned = false;
  /** Without the shared secret every call goes unsigned, and the Axya service refuses all of them; say so once. */
  private warnUnsigned(): void {
    if (this.warnedUnsigned) return;
    this.warnedUnsigned = true;
    this.logger.warn(
      'INTERNAL_API_SECRET is not set: calls to the Axya service go unsigned and will be refused. Set it to the same value as on the Axya service.',
    );
  }

  /**
   * Try a POST with primary URL, fall back to secondary on network error.
   */
  private async postWithFallback(
    path: string,
    data: any,
    config?: any,
  ): Promise<any> {
    try {
      return await this.axiosInstance.post(path, data, config);
    } catch (primaryError: any) {
      if (primaryError.response) {
        throw primaryError;
      }
      if (!this.fallbackInstance) {
        throw primaryError;
      }
      this.logger.warn(
        `Primary AI URL (${this.aiBaseUrl}) failed: ${primaryError.message}, trying fallback`,
      );
      return await this.fallbackInstance.post(path, data, config);
    }
  }

  /**
   * Extract LaTeX from an image file (binary).
   * Tries /v1/extract/img/tex first; falls back to /v1/extract/document on failure.
   */
  async extractLatexFromImage(
    imageBuffer: Buffer,
    filename: string,
    options?: {
      numBeams?: number;
      serviceId?: string;
    },
  ): Promise<{
    fragments: Array<{
      content: string;
      confidence?: number;
      out_format: string;
    }>;
    model: string;
    duration_ms: number;
  }> {
    try {
      const formData = new FormData();

      const serviceId = options?.serviceId || this.defaultServiceId;

      // Detect MIME type from filename extension
      const ext = filename.split('.').pop()?.toLowerCase() || 'png';
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        bmp: 'image/bmp',
        tiff: 'image/tiff',
      };
      const contentType = mimeMap[ext] || 'image/png';

      // Add file as binary (required)
      formData.append('file', imageBuffer, {
        filename,
        contentType,
      });

      // Add service_id (defaults to "texteller")
      formData.append('service_id', serviceId);

      // Add num_beams if provided
      if (options?.numBeams !== undefined) {
        formData.append('num_beams', options.numBeams.toString());
      }

      const response = await this.axiosInstance.post(
        '/v1/extract/img/tex',
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      this.logger.log(
        `LaTeX extraction completed in ${response.data.duration_ms || 0}ms`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`LaTeX extraction failed: ${error.message}`);

      if (error.response?.status === 503) {
        throw new HttpException(
          'AI service is currently unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      throw new HttpException(
        error.response?.data?.detail || 'Failed to extract LaTeX from image',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Extract LaTeX from a PDF file (multipart upload)
   */
  async extractLatexFromPdf(
    pdfBuffer: Buffer,
    filename: string,
    options?: {
      serviceId?: string;
    },
  ): Promise<any> {
    try {
      const formData = new FormData();

      const serviceId = options?.serviceId || this.defaultServiceId;

      // Add file as binary
      formData.append('file', pdfBuffer, {
        filename,
        contentType: 'application/pdf',
      });

      // Add service_id to form data (defaults to "texteller")
      formData.append('service_id', serviceId);

      const response = await this.axiosInstance.post(
        '/v1/extract/pdf/tex',
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      this.logger.log(`PDF extraction completed for ${filename}`);
      this.logger.debug(
        `PDF extraction response type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`,
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`PDF extraction failed: ${error.message}`);

      if (error.response?.status === 503) {
        throw new HttpException(
          'AI service is currently unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      throw new HttpException(
        error.response?.data?.detail || 'Failed to extract LaTeX from PDF',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Check if the AI service is healthy and ready
   */
  async healthCheck(serviceId?: string): Promise<{
    status: string;
    model_loaded: boolean;
    model_name: string;
    device: string;
  }> {
    try {
      const serviceIdParam = serviceId || this.defaultServiceId;
      const response = await this.axiosInstance.get(
        `/v1/health?service_id=${serviceIdParam}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`AI service health check failed: ${error.message}`);
      throw new HttpException(
        'AI service is not responding',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Transcribe audio to LaTeX via Axya's speech API.
   * POST /api/v1/speech/transcribe with audio file and prompt.
   */
  async transcribeSpeech(
    audioBuffer: Buffer,
    filename: string,
    options?: { prompt?: string },
  ): Promise<{ text: string }> {
    try {
      const formData = new FormData();

      formData.append('audio', audioBuffer, {
        filename: filename || 'audio.webm',
        contentType: 'audio/webm',
      });
      formData.append('prompt', options?.prompt || 'Use LaTeX');

      const response = await this.postWithFallback(
        '/api/v1/speech/transcribe',
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      const data = response.data;
      const text =
        data?.text ?? data?.transcript ?? data?.content ?? data?.result ?? '';
      this.logger.log(`Speech transcription completed`);
      return { text: typeof text === 'string' ? text : String(text || '') };
    } catch (error: any) {
      this.logger.error(`Speech transcription failed: ${error.message}`);

      if (error.response?.status === 503) {
        throw new HttpException(
          'AI speech service is currently unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      throw new HttpException(
        error.response?.data?.detail ||
          error.response?.data?.message ||
          'Failed to transcribe speech',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a signed URL from S3 for the given asset key.
   */
  async getImageUrl(s3Key: string, storageService: any): Promise<string> {
    try {
      return await storageService.getSignedUrl(s3Key, 900, 'assets');
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for ${s3Key}`);
      throw error;
    }
  }
}
