import { IsString, MinLength } from 'class-validator';

export class SubmitVocabReviewDto {
  // The translation text the student picked/typed — never a correctness
  // claim, never mastery/nextReview. The server looks up the real
  // translation and decides everything from there.
  @IsString()
  @MinLength(1)
  answer!: string;
}
