import React from "react";
export const Button = React.forwardRef<HTMLButtonElement, any>(({ variant, size, asChild, ...p }, ref) => <button ref={ref} type="button" {...p} />);
const Box = (p: any) => <div {...p} />;
export const Avatar = Box, AvatarFallback = Box, AvatarImage = Box, Badge = Box, Input = (p: any) => <input {...p} />;
export default Box;
