import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Prisma } from '@prisma/client';
import {
  CreateClientPaymentDto,
  CreateWorkerPaymentDto,
  CreateExpenseDto,
} from './dto/create-finance.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/** Assignment states a studio has actually committed money to. */
const BILLABLE_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.CONFIRMED,
  AssignmentStatus.COMPLETED,
];


@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Client payments
  // -------------------------------------------------------------------------

  async createClientPayment(dto: CreateClientPaymentDto, actor: AuthenticatedUser) {
    const studioId = this.requireStudio(actor);
    await this.assertBookingOwned(dto.bookingId, studioId);

    const payment = await this.prisma.clientPayment.create({
      data: {
        bookingId: dto.bookingId,
        amount: new Prisma.Decimal(dto.amount),
        paymentType: dto.paymentType,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        createdById: actor.id,
      },
    });
    return this.serializePayment(payment);
  }

  async getClientPayments(bookingId: string, actor: AuthenticatedUser) {
    await this.assertBookingOwned(bookingId, this.requireStudio(actor));
    const payments = await this.prisma.clientPayment.findMany({
      where: { bookingId },
      orderBy: { paymentDate: 'desc' },
    });
    return payments.map((p) => this.serializePayment(p));
  }

  // -------------------------------------------------------------------------
  // Worker payments
  // -------------------------------------------------------------------------

  async createWorkerPayment(dto: CreateWorkerPaymentDto, actor: AuthenticatedUser) {
    const studioId = this.requireStudio(actor);

    // The worker is derived from the assignment rather than taken from the
    // body, so a payout can never be recorded against the wrong person.
    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { id: dto.assignmentId, booking: { studioId } },
      include: { worker: true, booking: true },
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment with ID ${dto.assignmentId} not found`);
    }

    const payment = await this.prisma.workerPayment.create({
      data: {
        assignmentId: assignment.id,
        workerId: assignment.workerId,
        amount: new Prisma.Decimal(dto.amount),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        createdById: actor.id,
      },
    });

    if (assignment.worker.userId) {
      await this.prisma.notification.create({
        data: {
          userId: assignment.worker.userId,
          title: 'New Payout',
          message: `A payout of $${dto.amount} has been added for ${assignment.booking.title || 'booking'}. Please confirm.`,
          type: 'PAYMENT_PENDING',
          referenceId: payment.id,
        }
      });
    }

    return this.serializePayment(payment);
  }

  async getWorkerPaymentsByBooking(bookingId: string, actor: AuthenticatedUser) {
    await this.assertBookingOwned(bookingId, this.requireStudio(actor));
    const payments = await this.prisma.workerPayment.findMany({
      where: { assignment: { bookingId } },
      include: { worker: { include: { user: true } }, assignment: true },
      orderBy: { paymentDate: 'desc' },
    });
    return payments.map((p) => ({
      ...this.serializePayment(p),
      worker: {
        id: p.worker.id,
        workerPublicId: p.worker.workerPublicId,
        fullName:
          `${p.worker.user?.firstName ?? ''} ${p.worker.user?.lastName ?? ''}`.trim() ||
          p.worker.user?.email ||
          'Unknown',
      },
    }));
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------

  async createExpense(dto: CreateExpenseDto, actor: AuthenticatedUser) {
    const studioId = this.requireStudio(actor);
    if (dto.bookingId) {
      await this.assertBookingOwned(dto.bookingId, studioId);
    }

    const expense = await this.prisma.expense.create({
      data: {
        studioId,
        bookingId: dto.bookingId,
        category: dto.category,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
        notes: dto.notes,
      },
    });
    return { ...expense, amount: Number(expense.amount) };
  }

  async getExpensesByBooking(bookingId: string, actor: AuthenticatedUser) {
    await this.assertBookingOwned(bookingId, this.requireStudio(actor));
    const expenses = await this.prisma.expense.findMany({
      where: { bookingId },
      orderBy: { expenseDate: 'desc' },
    });
    return expenses.map((e) => ({ ...e, amount: Number(e.amount) }));
  }

  async deleteExpense(expenseId: string, actor: AuthenticatedUser) {
    const studioId = this.requireStudio(actor);
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
    });
    if (!expense || expense.studioId !== studioId) {
      throw new ForbiddenException('Cannot delete this expense');
    }
    await this.prisma.expense.delete({ where: { id: expenseId } });
    return { success: true };
  }

  async getStudioExpenses(actor: AuthenticatedUser) {
    const expenses = await this.prisma.expense.findMany({
      where: { studioId: this.requireStudio(actor) },
      orderBy: { expenseDate: 'desc' },
      take: 200,
    });
    return expenses.map((e) => ({ ...e, amount: Number(e.amount) }));
  }

  // -------------------------------------------------------------------------
  // Summaries
  // -------------------------------------------------------------------------

  async getStudioSummary(actor: AuthenticatedUser) {
    const studioId = this.requireStudio(actor);

    const [revenueAggr, clientPmtAggr, workerCostAggr, workerPaymentsAggr, expensesAggr] =
      await Promise.all([
        this.prisma.booking.aggregate({
          where: { studioId },
          _sum: { agreedPrice: true },
        }),
        this.prisma.clientPayment.aggregate({
          where: { booking: { studioId } },
          _sum: { amount: true },
        }),
        this.prisma.crewAssignment.aggregate({
          where: { booking: { studioId }, status: { in: BILLABLE_STATUSES } },
          _sum: { agreedFee: true },
        }),
        this.prisma.workerPayment.aggregate({
          where: { assignment: { booking: { studioId } } },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: { studioId },
          _sum: { amount: true },
        }),
      ]);

    const bookingRevenue = revenueAggr._sum.agreedPrice ?? new Prisma.Decimal(0);
    const clientPaymentsReceived = clientPmtAggr._sum.amount ?? new Prisma.Decimal(0);
    const workerCosts = workerCostAggr._sum.agreedFee ?? new Prisma.Decimal(0);
    const workerPayments = workerPaymentsAggr._sum.amount ?? new Prisma.Decimal(0);
    const otherExpenses = expensesAggr._sum.amount ?? new Prisma.Decimal(0);

    const studioProfit = bookingRevenue.sub(workerCosts).sub(otherExpenses);

    return {
      revenue: Number(bookingRevenue),
      clientPaymentsReceived: Number(clientPaymentsReceived),
      clientBalance: Number(bookingRevenue.sub(clientPaymentsReceived)),
      workerCosts: Number(workerCosts),
      workerPayments: Number(workerPayments),
      workerBalance: Number(workerCosts.sub(workerPayments)),
      otherExpenses: Number(otherExpenses),
      studioProfit: Number(studioProfit),
    };
  }

  async getWorkerSummary(workerId: string, actor: AuthenticatedUser) {
    const worker = await this.prisma.workerProfile.findFirst({
      where: { OR: [{ id: workerId }, { userId: workerId }] },
      select: { id: true, userId: true },
    });
    if (!worker) {
      throw new NotFoundException(`Worker profile not found for id ${workerId}`);
    }
    if (worker.userId !== actor.id) {
      const sharesStudio =
        actor.studioId !== null &&
        (await this.prisma.studioMember.findFirst({
          where: { studioId: actor.studioId, userId: worker.userId },
          select: { id: true },
        }));
      if (!sharesStudio) {
        throw new ForbiddenException("You cannot read this worker's earnings");
      }
    }

    // BILLABLE_STATUSES is the same constant the studio summary uses, so both
    // sides of the ledger always agree on what counts as earned.
    const assignmentsAggr = await this.prisma.crewAssignment.aggregate({
      where: { workerId: worker.id, status: { in: BILLABLE_STATUSES } },
      _sum: { agreedFee: true },
    });
    const totalEarned = assignmentsAggr._sum.agreedFee ?? new Prisma.Decimal(0);

    const paymentsAggr = await this.prisma.workerPayment.aggregate({
      where: { workerId: worker.id },
      _sum: { amount: true },
    });
    const totalPaid = paymentsAggr._sum.amount ?? new Prisma.Decimal(0);

    return {
      totalEarned: Number(totalEarned),
      totalPaid: Number(totalPaid),
      currentBalance: Number(totalEarned.sub(totalPaid)),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireStudio(actor: AuthenticatedUser): string {
    if (!actor.studioId) {
      throw new ForbiddenException('You are not a member of a studio');
    }
    return actor.studioId;
  }

  private async assertBookingOwned(bookingId: string, studioId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }
  }

  private serializePayment<T extends { amount: Prisma.Decimal }>(payment: T) {
    return { ...payment, amount: Number(payment.amount) };
  }
}
