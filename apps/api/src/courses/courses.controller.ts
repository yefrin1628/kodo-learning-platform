import { Controller, Get, Param } from '@nestjs/common';
import { CoursesService } from './courses.service';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  list() {
    return this.coursesService.list();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.coursesService.findBySlug(slug);
  }

  @Get(':slug/lessons')
  lessons(@Param('slug') slug: string) {
    return this.coursesService.lessonsForCourse(slug);
  }
}
