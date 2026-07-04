/**
 * Width of the left-edge strip claimed by MobileNav's drawer-open swipe.
 *
 * MobileNav preventDefaults touchstart in this zone (so those touches never
 * scroll anything), and the chat scroll controller must ignore them so an
 * edge swipe is never misread as scroll intent. Both sides import this one
 * constant — widening or narrowing the swipe zone in one place without the
 * other silently breaks stick-to-bottom during streaming.
 */
export const NAV_EDGE_SWIPE_ZONE_PX = 40;
