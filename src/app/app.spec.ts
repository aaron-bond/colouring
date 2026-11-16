import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('renders a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
  });
});
