import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private assetsClient: S3Client | null = null;
  private assetsBucket: string = '';

  private buildsClient: S3Client | null = null;
  private buildsBucket: string = '';

  constructor(private configService: ConfigService) {
    this.initAssetsClient();
    this.initBuildsClient();
  }

  private initAssetsClient() {
    // Eneles R2 is the canonical store. Keep the previous per-bucket
    // variables as fallbacks to allow a gradual migration without downtime.
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const region = this.configService.get<string>('ASSETS_BUCKET_REGION') ||
      this.configService.get<string>('R2_REGION') || 'auto';
    const accessKeyId = this.configService.get<string>('ASSETS_BUCKET_ACCESS_KEY_ID') ||
      this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('ASSETS_BUCKET_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('ASSETS_BUCKET_NAME') ||
      this.configService.get<string>('R2_BUCKET_NAME');
    const endpoint = this.configService.get<string>('ASSETS_BUCKET_ENDPOINT_URL') ||
      this.configService.get<string>('R2_ENDPOINT_URL') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn('Assets Storage configuration is missing.');
      return;
    }

    this.assetsClient = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      endpoint: endpoint || undefined,
      forcePathStyle: !!endpoint,
    });
    this.assetsBucket = bucket;
    this.logger.log(`Assets Storage initialized: ${bucket}`);
  }

  private initBuildsClient() {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const region = this.configService.get<string>('BUILDS_BUCKET_REGION') ||
      this.configService.get<string>('R2_REGION') || 'auto';
    const accessKeyId = this.configService.get<string>('BUILDS_BUCKET_ACCESS_KEY_ID') ||
      this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('BUILDS_BUCKET_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('BUILDS_BUCKET_NAME') ||
      this.configService.get<string>('R2_BUCKET_NAME');
    const endpoint = this.configService.get<string>('BUILDS_BUCKET_ENDPOINT_URL') ||
      this.configService.get<string>('R2_ENDPOINT_URL') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn('Builds Storage configuration is missing.');
      return;
    }

    this.buildsClient = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      endpoint: endpoint || undefined,
      forcePathStyle: !!endpoint,
    });
    this.buildsBucket = bucket;
    this.logger.log(`Builds Storage initialized: ${bucket}`);
  }

  // Default to Assets for backward compatibility
  async uploadFile(file: Buffer, key: string, contentType: string): Promise<string> {
    return this.uploadToBucket('assets', file, key, contentType);
  }

  async uploadBuild(file: Buffer, key: string, contentType: string = 'application/pdf'): Promise<string> {
    return this.uploadToBucket('builds', file, key, contentType);
  }

  private async uploadToBucket(type: 'assets' | 'builds', file: Buffer, key: string, contentType: string): Promise<string> {
    const client = type === 'assets' ? this.assetsClient : this.buildsClient;
    const bucket = type === 'assets' ? this.assetsBucket : this.buildsBucket;

    if (!client || !bucket) {
      throw new InternalServerErrorException(`${type} storage is not configured.`);
    }

    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      }));
      return key; // We typically return the key (path)
    } catch (error: any) {
      this.logger.error(`Failed to upload to ${type}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Upload failed: ${error.message}`);
    }
  }

  async getObject(key: string, type: 'assets' | 'builds' = 'assets'): Promise<{ Body: NodeJS.ReadableStream; ContentType?: string }> {
    const client = type === 'assets' ? this.assetsClient : this.buildsClient;
    const bucket = type === 'assets' ? this.assetsBucket : this.buildsBucket;
    if (!client || !bucket) throw new InternalServerErrorException(`${type} storage not configured`);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new InternalServerErrorException('Empty object body');
    return { Body: response.Body as NodeJS.ReadableStream, ContentType: response.ContentType };
  }

  async getSignedUrl(key: string, expiresIn: number = 900, type: 'assets' | 'builds' = 'assets'): Promise<string> {
    const client = type === 'assets' ? this.assetsClient : this.buildsClient;
    const bucket = type === 'assets' ? this.assetsBucket : this.buildsBucket;

    if (!client || !bucket) throw new InternalServerErrorException(`${type} storage not configured`);

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return await getSignedUrl(client, command, { expiresIn });
    } catch (error: any) {
      this.logger.error(`Failed to sign URL: ${error.message}`);
      throw new InternalServerErrorException(`URL signing failed: ${error.message}`);
    }
  }

  async deleteFile(key: string, type: 'assets' | 'builds' = 'assets'): Promise<void> {
    const client = type === 'assets' ? this.assetsClient : this.buildsClient;
    const bucket = type === 'assets' ? this.assetsBucket : this.buildsBucket;

    if (!client || !bucket) throw new InternalServerErrorException(`${type} storage not configured`);

    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error: any) {
      this.logger.error(`Failed to delete: ${error.message}`);
      throw new InternalServerErrorException(`Delete failed: ${error.message}`);
    }
  }

  async getFileSize(key: string, type: 'assets' | 'builds' = 'assets'): Promise<number | null> {
    const client = type === 'assets' ? this.assetsClient : this.buildsClient;
    const bucket = type === 'assets' ? this.assetsBucket : this.buildsBucket;

    if (!client || !bucket) return null;

    try {
      const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const response = await client.send(command);
      return response.ContentLength || null;
    } catch (error: any) {
      // File-not-found (NoSuchKey, 404) is expected when checking existence; use debug to avoid noise
      const msg = error?.message ?? error?.name ?? 'Unknown';
      this.logger.debug(`File not found or inaccessible: ${key} (${msg})`);
      return null;
    }
  }

  generateKey(userId: number, folder: string, filename: string): string {
    const timestamp = Date.now();
    return `${folder}/${userId}/${timestamp}_${filename}`;
  }
}
