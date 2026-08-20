import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, put } from '@vercel/blob';
import { PrismaService } from '../prisma/prisma.service';

export const AVATAR_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  assertConfigured() {
    if (!this.config.get<string>('BLOB_READ_WRITE_TOKEN')) {
      throw new ServiceUnavailableException('La subida de avatares no está configurada en este entorno.');
    }
  }

  /** El cliente recorta a cuadrado y convierte a webp antes de subir, pero
   * esto vuelve a validar tipo y tamaño reales del lado del servidor —
   * multer ya filtra por mimetype declarado, esto es la segunda capa que
   * no depende de lo que el cliente diga que es el archivo. */
  async setAvatar(userId: string, file: Express.Multer.File | undefined) {
    this.assertConfigured();

    if (!file) {
      throw new BadRequestException('No se recibió ninguna imagen.');
    }
    if (!AVATAR_ALLOWED_CONTENT_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagen no permitido.');
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('La imagen supera el tamaño máximo permitido.');
    }

    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const blob = await put(`avatars/${userId}/avatar.${extension}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      addRandomSuffix: true,
    });

    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const previousUrl = profile?.avatarUrl;

    const updated = await this.prisma.userProfile.update({ where: { userId }, data: { avatarUrl: blob.url } });

    if (previousUrl && previousUrl !== blob.url) {
      // Best-effort: si falla el borrado del avatar anterior, no bloquea la
      // respuesta — solo queda un blob huérfano, no un dato inconsistente.
      del(previousUrl).catch(() => {});
    }

    return { avatarUrl: updated.avatarUrl };
  }

  async deleteAvatar(userId: string) {
    this.assertConfigured();
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (profile?.avatarUrl) {
      del(profile.avatarUrl).catch(() => {});
    }
    await this.prisma.userProfile.update({ where: { userId }, data: { avatarUrl: null } });
    return { avatarUrl: null };
  }
}
