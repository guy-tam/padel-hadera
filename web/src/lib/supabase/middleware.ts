import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// רענון session + קבלת משתמש בקצה
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: any }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAppRoute = pathname.startsWith('/app');
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  // לא מחובר + נכנס לאזור אפליקציה → /login
  if (isAppRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // מחובר + נכנס ל-login/signup → /app (ינתב לפי role)
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // בדיקת role בתוך /app/{role}
  if (isAppRoute && user) {
    const segments = pathname.split('/').filter(Boolean);
    const targetRole = segments[1]; // app/<role>
    if (targetRole && ['player', 'organizer', 'club', 'admin'].includes(targetRole)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile && profile.role !== targetRole && profile.role !== 'admin') {
        const url = request.nextUrl.clone();
        url.pathname = `/app/${profile.role}`;
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}
