import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { FinanceService } from './finance.service';
import {
  CreateClientPaymentDto,
  CreateWorkerPaymentDto,
  CreateExpenseDto,
} from './dto/create-finance.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { Roles } from '../auth/roles.decorator';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post('client-payments')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Record a client payment' })
  createClientPayment(
    @Body() dto: CreateClientPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.createClientPayment(dto, user);
  }

  @Get('client-payments/booking/:bookingId')
  @ApiOperation({ summary: 'List all client payments for a booking' })
  getClientPayments(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getClientPayments(bookingId, user);
  }

  @Post('worker-payments')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Record a payout to a worker' })
  createWorkerPayment(
    @Body() dto: CreateWorkerPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.createWorkerPayment(dto, user);
  }

  @Get('worker-payments/booking/:bookingId')
  @ApiOperation({ summary: 'List all worker payments for a booking' })
  getWorkerPayments(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getWorkerPaymentsByBooking(bookingId, user);
  }

  @Post('expenses')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Record a studio or booking expense' })
  createExpense(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.createExpense(dto, user);
  }

  @Get('expenses')
  @ApiOperation({ summary: "List the studio's recent expenses" })
  getStudioExpenses(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.getStudioExpenses(user);
  }

  @Get('expenses/booking/:bookingId')
  @ApiOperation({ summary: 'List all expenses for a booking' })
  getExpenses(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getExpensesByBooking(bookingId, user);
  }

  @Delete('expenses/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete an expense' })
  deleteExpense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.deleteExpense(id, user);
  }

  @Get('summary')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Financial KPIs for the caller's studio" })
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.getStudioSummary(user);
  }

  @Get('worker/me')
  @ApiOperation({ summary: 'Total earned and balance for the caller' })
  getMyWorkerSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.getWorkerSummary(user.id, user);
  }

  @Get('worker/:workerId')
  @ApiOperation({ summary: 'Total earned and balance for a worker' })
  getWorkerSummary(
    @Param('workerId') workerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getWorkerSummary(workerId, user);
  }
}
