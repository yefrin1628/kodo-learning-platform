import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_BYTES = 48;
const SALT_ROUNDS = 12;

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async issueTokenPair(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES') ?? '15m',
      },
    );

    const refreshRaw = crypto.randomBytes(REFRESH_BYTES).toString('hex');
    const refreshDays = Number(this.config.get('JWT_REFRESH_EXPIRES_DAYS') ?? 30);
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshRaw),
        expiresAt,
      },
    });

    return { accessToken, refreshToken: refreshRaw };
  }

  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Ese correo ya está registrado.');
    }
    const existingUsername = await this.prisma.profile.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('Ese nombre de usuario ya está en uso.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        profile: {
          create: {
            username: dto.username,
            displayName: dto.displayName,
          },
        },
        streak: {
          create: {},
        },
      },
      include: { profile: true },
    });

    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { profile: true },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(refreshRaw: string) {
    const tokenHash = hashToken(refreshRaw);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokenPair(record.userId);
  }

  async logout(refreshRaw: string) {
    const tokenHash = hashToken(refreshRaw);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private toPublicUser(user: { id: string; email: string; profile: unknown }) {
    return { id: user.id, email: user.email, profile: user.profile };
  }
}
