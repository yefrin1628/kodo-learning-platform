import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VocabularyService } from './vocabulary.service';
import { SubmitVocabReviewDto } from './dto/submit-vocab-review.dto';

@UseGuards(JwtAuthGuard)
@Controller('vocabulary')
export class VocabularyController {
  constructor(private readonly vocabularyService: VocabularyService) {}

  @Get(':courseSlug')
  list(@CurrentUser() user: { userId: string }, @Param('courseSlug') courseSlug: string) {
    return this.vocabularyService.listForCourse(user.userId, courseSlug);
  }

  @Post(':vocabularyId/review')
  review(
    @CurrentUser() user: { userId: string },
    @Param('vocabularyId') vocabularyId: string,
    @Body() dto: SubmitVocabReviewDto,
  ) {
    return this.vocabularyService.submitReview(user.userId, vocabularyId, dto.answer);
  }
}
