import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// objectStore 'fieldPhotos' → bucket "fieldops-photos"
export const fieldPhotosBucket = process.env.FIELD_PHOTOS_URL_BUCKET ?? "fieldops-photos";
export const fieldPhotos = new S3Client({
  region: process.env.FIELD_PHOTOS_URL_REGION ?? "eu-central-1",
});

export async function fieldPhotos$put(key: string, body: unknown): Promise<void> {
  await fieldPhotos.send(
    new PutObjectCommand({
      Bucket: fieldPhotosBucket,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: "application/json",
    }),
  );
}

export async function fieldPhotos$get(key: string): Promise<unknown> {
  try {
    const res = await fieldPhotos.send(new GetObjectCommand({ Bucket: fieldPhotosBucket, Key: key }));
    const text = await res.Body?.transformToString();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function fieldPhotos$list(prefix: string): Promise<string[]> {
  const res = await fieldPhotos.send(new ListObjectsV2Command({ Bucket: fieldPhotosBucket, Prefix: prefix }));
  return (res.Contents ?? []).map((o) => o.Key ?? "").filter((k) => k.length > 0);
}

export async function fieldPhotos$signedUrl(key: string): Promise<string> {
  return getSignedUrl(fieldPhotos, new GetObjectCommand({ Bucket: fieldPhotosBucket, Key: key }), { expiresIn: 3600 });
}

export async function fieldPhotos$delete(key: string): Promise<void> {
  await fieldPhotos.send(new DeleteObjectCommand({ Bucket: fieldPhotosBucket, Key: key }));
}

export async function fieldPhotos$putBytes(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await fieldPhotos.send(
    new PutObjectCommand({
      Bucket: fieldPhotosBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function fieldPhotos$getBytes(key: string): Promise<{ body: Uint8Array; contentType: string; size: number } | null> {
  try {
    const res = await fieldPhotos.send(new GetObjectCommand({ Bucket: fieldPhotosBucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;
    return { body: bytes, contentType: res.ContentType ?? "application/octet-stream", size: bytes.byteLength };
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

