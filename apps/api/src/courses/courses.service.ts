import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const courses = await this.prisma.course.findMany({
      where: { isPublished: true },
      orderBy: { order: 'asc' },
      include: { _count: { select: { units: true } } },
    });

    return Promise.all(
      courses.map(async (c) => {
        const lessonCount = await this.prisma.lesson.count({ where: { unit: { courseId: c.id } } });
        return {
          slug: c.slug,
          title: c.title,
          description: c.description,
          type: c.type,
          language: c.language,
          level: c.level,
          colorHex: c.colorHex,
          flagEmoji: c.flagEmoji,
          order: c.order,
          unitCount: c._count.units,
          lessonCount,
        };
      }),
    );
  }

  async findBySlug(slug: string) {
    const course = await this.prisma.course.findUnique({
      where: { slug },
      include: {
        units: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              select: { key: true, title: true, icon: true, order: true, isProject: true, baseXP: true },
            },
          },
        },
      },
    });
    if (!course || !course.isPublished) {
      throw new NotFoundException(`Curso "${slug}" no encontrado.`);
    }
    return course;
  }

  async lessonsForCourse(slug: string) {
    const course = await this.prisma.course.findUnique({ where: { slug } });
    if (!course || !course.isPublished) {
      throw new NotFoundException(`Curso "${slug}" no encontrado.`);
    }
    return this.prisma.lesson.findMany({
      where: { unit: { courseId: course.id } },
      orderBy: [{ unit: { order: 'asc' } }, { order: 'asc' }],
      select: {
        key: true,
        title: true,
        icon: true,
        order: true,
        isProject: true,
        baseXP: true,
        unit: { select: { key: true, title: true, order: true } },
      },
    });
  }
}
