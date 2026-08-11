import { Controller, Get, Param } from '@nestjs/common';
import { LessonsService } from './lessons.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.lessonsService.findByKey(key);
  }
}
