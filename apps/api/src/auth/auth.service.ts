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
// Computed once at module load, never from real data — exists purely so
// login() always pays the same bcrypt.compare() cost whether or not the
// email matches a real account. Without this, a nonexistent-email request
// short-circuits before ever calling bcrypt (which is deliberately slow),
// making it measurably faster than a wrong-password request for a real
// account — a timing side-channel an attacker can use to enumerate which
// emails have accounts, even though the error message itself is generic.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('kodo-timing-safe-dummy', SALT_ROUNDS);

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
    const existingUsername = await this.prisma.userProfile.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('Ese nombre de usuario ya está en uso.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        userProfile: {
          create: {
            username: dto.username,
            displayName: dto.displayName,
          },
        },
        userStats: {
          create: {},
        },
        streak: {
          create: {},
        },
      },
      include: { userProfile: true },
    });

    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { userProfile: true },
    });
    // Always compare, even for a nonexistent email — see DUMMY_PASSWORD_HASH.
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(refreshRaw: string) {
    const tokenHash = hashToken(refreshRaw);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (record?.revokedAt) {
      // This exact token was already used once — reusing an already-revoked
      // refresh token is the classic signal of a stolen token racing the
      // legitimate client (rotation means a valid client never replays one).
      // Treat it as compromise: kill every other active session for this
      // user, not just reject this one request.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    if (!record || record.expiresAt < new Date()) {
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

  private toPublicUser(user: { id: string; email: string; userProfile: unknown }) {
    return { id: user.id, email: user.email, profile: user.userProfile };
  }
}
