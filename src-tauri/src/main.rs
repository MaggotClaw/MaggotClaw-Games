// Hide the console window on Windows release builds; without this the GUI app is
// compiled as a console subsystem binary and Windows opens a terminal alongside it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    the_long_rot_voice_lib::run();
}
