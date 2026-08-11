import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(key: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { key },
      include: {
        unit: { include: { course: { select: { slug: true, title: true, type: true, language: true } } } },
        project: true,
        exercises: {
          orderBy: { order: 'asc' },
          include: { options: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException(`Lección "${key}" no encontrada.`);
    }
    return lesson;
  }
}
