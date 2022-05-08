import { Inject, Injectable, Scope, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REQUEST } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { Request } from 'express';
import { URLSearchParams } from 'url';
import { ErrorActions } from '../types/actions.types';
import {
  GetQuestionsFilters,
  MeliApiError,
  MeliItem,
  MeliItemSearchResponse,
  MeliSendMessageOptions,
  QuestionsResponseTime,
} from '../types/meli.types';
import { MeliOauth } from './meli.oauth.js';

@Injectable({ scope: Scope.REQUEST })
export class MeliFunctions {
  private get token() {
    return this.userConfig.meliAccess;
  }

  private set token(newToken: string) {
    this.req.user.config.meliAccess = newToken;
  }

  private get sellerId() {
    return this.userConfig.meliId;
  }

  private get refreshToken() {
    return this.userConfig.meliRefresh;
  }

  private set refreshToken(newToken: string) {
    this.req.user.config.meliRefresh = newToken;
  }

  private httpInstance = axios.create();

  private get userConfig() {
    return this.req.user.config;
  }

  constructor(
    private readonly config: ConfigService,
    private readonly emitter: EventEmitter2,
    private readonly meliOauth: MeliOauth,
    @Inject(REQUEST) private req: Request,
  ) {
    this.httpInstance.defaults.baseURL = this.config.get('MELI_API_URL');

    this.httpInstance.interceptors.request.use((config) => {
      config.headers.Authorization = `Bearer ${this.token}`;

      return config;
    });

    this.httpInstance.interceptors.response.use(
      (res) => res,
      async (error) => {
        const prevRequest = error?.config;

        const errorCodes = [401];

        if (errorCodes.includes(error?.response?.status) && !prevRequest?.sent) {
          prevRequest.sent = true;
          console.log('refreshing after request error');

          const refreshResponse = await this.meliOauth.refreshAccessToken(this.userConfig.meliRefresh);

          if ('error' in refreshResponse.data) {
            throw new UnauthorizedException({
              message: 'Please link meli again',
              action: ErrorActions.LinkMeli,
            });
          }

          this.token = refreshResponse.data.access_token;
          this.refreshToken = refreshResponse.data.refresh_token;
          prevRequest.headers['Authorization'] = `Bearer ${this.token}`;

          await this.emitter.emitAsync('meli.tokens.update', refreshResponse.data);

          return this.httpInstance(prevRequest);
        }

        return Promise.reject(error);
      },
    );
  }

  async getQuestionsResponseTime(): Promise<AxiosResponse<QuestionsResponseTime | MeliApiError>> {
    try {
      const response = await this.httpInstance.get(`${this.sellerId}/questions/response_time`);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  /**
   * Get seller questions, if no filters passed, defaults to all unanswered questions
   *
   * @param filters GetQuestionsFilters
   * Only pass one of the filters, the only acceptable combination is From and Item, the rest must be individual
   */
  async getQuestions(filters?: GetQuestionsFilters): Promise<AxiosResponse<any | MeliApiError>>  {
    const params = new URLSearchParams();

    let url = `/questions/search`;

    if (filters?.from && filters.item) {
      params.append('from', filters.from.toString());
      params.append('item', filters.item);

      url = `/questions/search`;
    } else {
      params.append('seller_id', this.sellerId.toString());
    }

    if (filters?.status) {
      params.append('status', filters.status);
    } else {
      params.append('status', 'UNANSWERED');
    }

    if (filters?.sort) {
      params.append('sort_types', filters.sort.order);
      params.append('sort_fields', filters.sort.fields);
    }

    params.append('limit', filters?.limit?.toString() || '25');
    params.append('offset', filters?.offset?.toString() || '0');

    if (filters?.questionId) {
      url = `/questions/${filters.questionId}`;
      params.delete('*');
    }

    params.append('api_version', '4');

    try {
      const response = await this.httpInstance.get(url, { params });
      // console.log(response);

      return response;
    } catch (error) {
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async answerQuestion({ id, answer }: { id: number; answer: string }) {
    try {
      const response = await this.httpInstance.post(`/answers`, {
        question_id: id,
        text: answer,
      });

      return response;
    } catch (error) {
      // console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async deleteQuestion(questionId: number) {
    try {
      const response = await this.httpInstance.delete(`/questions/${questionId}`);
      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async searchForItems(searchQuery: string): Promise<AxiosResponse<MeliItemSearchResponse | MeliApiError>> {
    try {
      const response = await this.httpInstance.get(`/users/${this.sellerId}/items/search?q=${searchQuery}&status=active`);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async publishItem(itemInfo: any) {
    try {
      const response = await this.httpInstance.post('/items', itemInfo);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async addDescription(itemId: string, description: string) {
    try {
      const response = await this.httpInstance.post(`/items/${itemId}/description`, {
        plain_text: description,
      });

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async pauseItem(itemId: string): Promise<AxiosResponse<any | MeliApiError>> {
    try {
      const response = await this.httpInstance.put(`/items/${itemId}`, { status: 'paused' });

      // console.log(response);
      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async activateItem(itemId: string): Promise<AxiosResponse<any | MeliApiError>> {
    try {
      const response = await this.httpInstance.put(`/items/${itemId}`, { status: 'active' });

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async changeItemStock(itemId: string, newStock: number) {
    try {
      const response = await this.httpInstance.put(`/items/${itemId}`, { available_quantity: newStock });

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async getItems() {
    try {
      const response = await this.httpInstance.get(`/users/${this.sellerId}/items/search`);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async getItem(itemId: string, attrs?: string[]): Promise<AxiosResponse<MeliItem | MeliApiError>> {
    const params = new URLSearchParams();
    if (attrs) {
      params.append('attributes', attrs.join(','));
    }

    try {
      const response = await this.httpInstance.get<MeliItem>(`/items/${itemId}`, { params });

      return response;
    } catch (error) {
      const axiosError = error as AxiosError<MeliApiError>;
      return axiosError.response;
    }
  }

  async getUserInfo(buyerId: number) {
    try {
      const response = await this.httpInstance.get(`/users/${buyerId}`);
      // console.log(response);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async getOrders(filters?: string) {
    let url;

    switch (filters) {
      case 'recent':
        url = `/orders/search/recent?seller=${this.sellerId}&sort=date_desc`;
        break;
      case 'pending':
        url = `/orders/search/pending?seller=${this.sellerId}&sort=date_desc`;
        break;
      case 'archived':
        url = `/orders/search/archived?seller=${this.sellerId}&sort=date_desc`;
        break;
      default:
        url = `/orders/search?seller=${this.sellerId}&sort=date_desc`;
        break;
    }
    // order.date_created.from=2021-10-01T00:00:00.000-00:00&order.date_created.to=2021-12-31T00:00:00.000-00:00&sort=date_desc
    try {
      const response = await this.httpInstance.get(url);

      // console.log(response);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async getOrderInfo(orderId: number) {
    {
      try {
        const response = await this.httpInstance.get(`/orders/${orderId}`);

        return response;
      } catch (error) {
        console.log(error);
        if (error.isAxiosError) {
          return error.response;
        }

        throw error;
      }
    }
  }

  async getOrderMessages(orderId: number) {
    try {
      const response = await this.httpInstance.get(`/messages/packs/${orderId}/sellers/${this.sellerId}?mark_as_read=false?tag=post_sale`);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async sendMessage(options: MeliSendMessageOptions) {
    try {
      const response = await this.httpInstance.post(`/messages/packs/${options.msgGroupId}/sellers/${this.sellerId}?tag=post_sale`, {
        from: {
          user_id: this.sellerId,
        },
        to: {
          user_id: options.buyerId,
        },
        text: options.message,
      });

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }

  async getResource(resource: string) {
    try {
      const response = await this.httpInstance.get(`${resource}`);

      return response;
    } catch (error) {
      console.log(error);
      if (error.isAxiosError) {
        return error.response;
      }

      throw error;
    }
  }
}